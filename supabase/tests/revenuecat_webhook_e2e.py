#!/usr/bin/env python3
# ============================================================================
# revenuecat-webhook edge function — LOCAL end-to-end test for the CONSUMABLE
# credit-pack lifecycle (no RevenueCat account needed; events are synthesised).
#
# Drives the real function over HTTP and asserts what actually landed in
# ai_credit_ledger / ai_credit_balance:
#   * iOS + Android purchase   → grant keyed 'rc:<store txn>', platform stamped
#   * redelivery               → idempotent (granted once)
#   * refund (REAL shape)      → clawback reverses exactly the grant, balance 0
#   * refund redelivery        → idempotent (no double debit)
#   * plain cancel             → NOT a refund: credits untouched
#   * refund *before* grant    → tombstone, and the late grant is REFUSED
#   * REFUND_REVERSED          → restores exactly what was clawed back; a reversed
#                                tombstone stops blocking the grant
#   * grant with no txn key    → 'rcev:<event id>' ref, NOT refund-matchable
#
# WHY IT EXISTS: the refund-before-grant guard (mig 134) read ai_credit_ledger
# directly, but that table is RPC-only, so the read answered 42501 on every call
# and the discarded error made the guard a no-op — credits were issued for
# already-refunded purchases. Nothing caught it until this test existed. mig 158
# routes the check through credit_grant_is_refunded() and fails closed.
#
# AND WHY IT MISSED THE NEXT ONE: this file used to synthesise `type: "REFUND"`,
# which RevenueCat does not send. A real store refund arrives as CANCELLATION with
# cancel_reason=CUSTOMER_SUPPORT and a negative price, and the webhook read the
# non-existent key `cancellation_reason` — so no refund ever reached the clawback,
# while the suite stayed green against an event shape that cannot occur. Every
# refund case below now uses the shape RevenueCat documents; the legacy REFUND type
# is exercised once, on its own, precisely because it is NOT the real path.
#
# The ONE thing this cannot prove is whether RevenueCat really populates
# transaction_id / original_transaction_id for store consumables — that is a
# property of RC's payload, not our code, and only a sandbox purchase settles it.
# The no-transaction-key fallback is therefore exercised explicitly (case 7).
#
# Requires `supabase start` + migrations applied. NOT CI-wired (needs the Docker
# stack + a served function). Run:
#   printf 'REVENUECAT_WEBHOOK_AUTH=local-test-token-abc123\n' > /tmp/rc.env
#   supabase status -o json | python3 -c "import json,sys;d=json.load(sys.stdin);\
#     print('SUPABASE_URL='+d['API_URL']);print('SUPABASE_SERVICE_ROLE_KEY='+d['SERVICE_ROLE_KEY'])" >> /tmp/rc.env
#   supabase functions serve revenuecat-webhook --env-file /tmp/rc.env --no-verify-jwt &
#   python3 supabase/tests/revenuecat_webhook_e2e.py
# ============================================================================
import json
import subprocess
import urllib.request

URL = "http://127.0.0.1:54321/functions/v1/revenuecat-webhook"
TOKEN = "local-test-token-abc123"
DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

U_IOS = "b7000000-0000-0000-0000-0000000000a1"
U_AND = "b7000000-0000-0000-0000-0000000000a2"
U_TOMB = "b7000000-0000-0000-0000-0000000000a3"
U_NOTX = "b7000000-0000-0000-0000-0000000000a4"
U_SBX  = "b7000000-0000-0000-0000-0000000000a5"
U_PROD = "b7000000-0000-0000-0000-0000000000a6"
U_ADM  = "b7000000-0000-0000-0000-0000000000a7"
U_CANC = "b7000000-0000-0000-0000-0000000000a8"   # plain cancel, must keep credits
U_NEG  = "b7000000-0000-0000-0000-0000000000a9"   # negative price, no cancel_reason
U_REV  = "b7000000-0000-0000-0000-0000000000aa"   # refund then REFUND_REVERSED
U_LEGA = "b7000000-0000-0000-0000-0000000000ab"   # legacy REFUND event type
U_SUB  = "b7000000-0000-0000-0000-0000000000ac"   # subscription refund

USERS = [U_IOS, U_AND, U_TOMB, U_NOTX, U_SBX, U_PROD, U_ADM, U_CANC, U_NEG, U_REV, U_LEGA, U_SUB]

fails = []


def sql(q: str) -> str:
    r = subprocess.run(["psql", DB, "-t", "-A", "-c", q], capture_output=True, text=True)
    return r.stdout.strip()


def post(event: dict) -> tuple[int, dict]:
    body = json.dumps({"event": event}).encode()
    req = urllib.request.Request(
        URL, data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(name: str, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"   got={got!r} want={want!r}"))
    if not ok:
        fails.append(name)


# ── fixtures ───────────────────────────────────────────────────────────────
USER_LIST = ",".join(f"'{u}'" for u in USERS)
sql(f"""
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES {",".join(f"('{u}')" for u in USERS)} ON CONFLICT DO NOTHING;
DELETE FROM ai_credit_ledger  WHERE user_id IN ({USER_LIST});
DELETE FROM ai_credit_balance WHERE user_id IN ({USER_LIST});
DELETE FROM billing_subscriptions WHERE user_id IN ({USER_LIST});
""")

grant_micro = int(sql("select credits_micro_won from billing_products where id='credits_1000'"))
print(f"catalog: credits_1000 grants {grant_micro} micro-USD\n")


def pack_event(**kw):
    e = {
        "type": "NON_RENEWING_PURCHASE",
        "id": kw.pop("id", "evt-default"),
        "app_user_id": kw.pop("user"),
        "product_id": "ai_credit_099",
        "store": kw.pop("store", "APP_STORE"),
    }
    e.update(kw)
    return e


def refund_event(**kw):
    """The shape RevenueCat actually delivers for a store refund: CANCELLATION with
    cancel_reason=CUSTOMER_SUPPORT and a NEGATIVE price. There is no REFUND type."""
    e = pack_event(**kw)
    e.update({"type": "CANCELLATION", "cancel_reason": "CUSTOMER_SUPPORT",
              "currency": "USD", "price": -0.99, "price_in_purchased_currency": -0.99,
              "tax_percentage": 0.0, "commission_percentage": 0.3})
    return e


print("1) iOS consumable purchase → grant keyed on the store transaction")
st, body = post(pack_event(id="evt-1", user=U_IOS, transaction_id="1000000111"))
check("HTTP 200", st, 200)
check("kind=credit_pack", body.get("kind"), "credit_pack")
check("platform stamped ios", body.get("platform"), "ios")
check("ledger ref = rc:<txn>", sql(f"select ref from ai_credit_ledger where user_id='{U_IOS}' and delta>0"), "rc:1000000111")
check("ledger platform = ios", sql(f"select platform from ai_credit_ledger where user_id='{U_IOS}' and delta>0"), "ios")
check("balance credited", sql(f"select balance from ai_credit_balance where user_id='{U_IOS}'"), str(grant_micro))

print("\n2) same event redelivered → idempotent, no double credit")
st, _ = post(pack_event(id="evt-1", user=U_IOS, transaction_id="1000000111"))
check("HTTP 200", st, 200)
check("still ONE grant row", sql(f"select count(*) from ai_credit_ledger where user_id='{U_IOS}' and delta>0"), "1")
check("balance unchanged", sql(f"select balance from ai_credit_balance where user_id='{U_IOS}'"), str(grant_micro))

print("\n3) refund in the REAL RevenueCat shape → clawback reverses exactly the grant")
st, body = post(refund_event(id="evt-2", user=U_IOS, transaction_id="1000000111"))
check("HTTP 200", st, 200)
check("routed to the credit-pack clawback", body.get("kind"), "credit_pack")
check("reversal row written", sql("select count(*) from ai_credit_ledger where ref='refund:rc:1000000111'"), "1")
check("reversal amount = -grant", sql("select delta from ai_credit_ledger where ref='refund:rc:1000000111'"), f"-{grant_micro}")
check("balance back to zero", sql(f"select balance from ai_credit_balance where user_id='{U_IOS}'"), "0")

print("\n4) refund redelivered → idempotent, balance not double-debited")
post(refund_event(id="evt-2b", user=U_IOS, transaction_id="1000000111"))
check("still ONE reversal", sql("select count(*) from ai_credit_ledger where ref='refund:rc:1000000111'"), "1")
check("balance still zero", sql(f"select balance from ai_credit_balance where user_id='{U_IOS}'"), "0")

print("\n4a) a PLAIN cancel (auto-renew off) is NOT a refund → credits untouched")
post(pack_event(id="evt-2c", user=U_CANC, transaction_id="1000000333"))
check("granted first", sql(f"select balance from ai_credit_balance where user_id='{U_CANC}'"), str(grant_micro))
st, body = post(pack_event(type="CANCELLATION", id="evt-2d", user=U_CANC, transaction_id="1000000333",
                           cancel_reason="UNSUBSCRIBE", price=0.0))
check("HTTP 200", st, 200)
check("no clawback row", sql("select count(*) from ai_credit_ledger where ref='refund:rc:1000000333'"), "0")
check("balance untouched", sql(f"select balance from ai_credit_balance where user_id='{U_CANC}'"), str(grant_micro))

print("\n4b) negative price with NO cancel_reason still counts as a refund")
post(pack_event(id="evt-2e", user=U_NEG, transaction_id="1000000444"))
st, body = post(pack_event(type="CANCELLATION", id="evt-2f", user=U_NEG,
                           transaction_id="1000000444", price=-0.99))
check("HTTP 200", st, 200)
check("clawed back on the price signal alone", body.get("clawed"), grant_micro)
check("balance zero", sql(f"select balance from ai_credit_balance where user_id='{U_NEG}'"), "0")

print("\n4c) legacy REFUND type is still honoured (not RC's current shape)")
post(pack_event(id="evt-2g", user=U_LEGA, transaction_id="1000000555"))
st, body = post(pack_event(type="REFUND", id="evt-2h", user=U_LEGA, transaction_id="1000000555"))
check("HTTP 200", st, 200)
check("clawed back", body.get("clawed"), grant_micro)
check("balance zero", sql(f"select balance from ai_credit_balance where user_id='{U_LEGA}'"), "0")

print("\n5) Android purchase → same path, platform recorded as android")
st, body = post(pack_event(id="evt-3", user=U_AND, store="PLAY_STORE", transaction_id="GPA.3311-1111-2222-33333"))
check("platform stamped android", body.get("platform"), "android")
check("ledger platform = android", sql(f"select platform from ai_credit_ledger where user_id='{U_AND}' and delta>0"), "android")

print("\n6) refund arrives BEFORE the grant (out-of-order delivery)")
st, _ = post(refund_event(id="evt-4", user=U_TOMB, transaction_id="1000000222"))
check("refund acked", st, 200)
check("tombstone written", sql("select count(*) from ai_credit_ledger where ref='refund:rc:1000000222'"), "1")
st, body = post(pack_event(id="evt-5", user=U_TOMB, transaction_id="1000000222"))
check("late grant is REFUSED", body.get("ignored"), "already_refunded")
check("no credits granted", sql(f"select coalesce(max(balance),0) from ai_credit_balance where user_id='{U_TOMB}'"), "0")

print("\n7) grant with NO store transaction key → event-id ref, NOT refund-matchable")
st, body = post({"type": "NON_RENEWING_PURCHASE", "id": "evt-6", "app_user_id": U_NOTX,
                 "product_id": "ai_credit_099", "store": "APP_STORE"})
check("HTTP 200", st, 200)
check("falls back to rcev: ref", sql(f"select ref from ai_credit_ledger where user_id='{U_NOTX}' and delta>0"), "rcev:evt-6")
st, body = post({"type": "CANCELLATION", "id": "evt-7", "app_user_id": U_NOTX, "cancel_reason": "CUSTOMER_SUPPORT",
                 "price": -0.99, "product_id": "ai_credit_099", "store": "APP_STORE"})
check("refund acked but cannot match", body.get("ignored"), "no_txn_key")
check("credits NOT clawed back (known gap)", sql(f"select balance from ai_credit_balance where user_id='{U_NOTX}'"), str(grant_micro))

# ── REFUND_REVERSED (mig 170) ──────────────────────────────────────────────
# The App Store can undo a refund. Before mig 170 nothing handled it: the clawback
# stood forever, so the customer had paid and held nothing.
print("\n7a) REFUND_REVERSED restores exactly what was clawed back, once")
post(pack_event(id="evt-r1", user=U_REV, transaction_id="1000000666"))
post(refund_event(id="evt-r2", user=U_REV, transaction_id="1000000666"))
check("clawed back first", sql(f"select balance from ai_credit_balance where user_id='{U_REV}'"), "0")
st, body = post(pack_event(type="REFUND_REVERSED", id="evt-r3", user=U_REV, transaction_id="1000000666", price=0.99))
check("HTTP 200", st, 200)
check("restored the exact amount", body.get("restored"), grant_micro)
check("balance restored", sql(f"select balance from ai_credit_balance where user_id='{U_REV}'"), str(grant_micro))
st, body = post(pack_event(type="REFUND_REVERSED", id="evt-r4", user=U_REV, transaction_id="1000000666", price=0.99))
check("redelivery is a no-op", body.get("already"), True)
check("balance unchanged by the redelivery", sql(f"select balance from ai_credit_balance where user_id='{U_REV}'"), str(grant_micro))
check("exactly ONE reversal row", sql("select count(*) from ai_credit_ledger where ref='reversal:rc:1000000666'"), "1")

print("\n7b) reversing a TOMBSTONE restores nothing but unblocks the late grant")
st, body = post(pack_event(type="REFUND_REVERSED", id="evt-r5", user=U_TOMB, transaction_id="1000000222", price=0.99))
check("nothing to restore (tombstone took nothing)", body.get("restored"), 0)
check("tombstone lifted", body.get("tombstone_lifted"), True)
st, body = post(pack_event(id="evt-r6", user=U_TOMB, transaction_id="1000000222"))
check("the grant is no longer refused", body.get("kind"), "credit_pack")
check("credits finally granted", sql(f"select balance from ai_credit_balance where user_id='{U_TOMB}'"), str(grant_micro))


print("\n7c) a SUBSCRIPTION refund revokes access now, not at period end")
sub_event = {"type": "INITIAL_PURCHASE", "id": "evt-s1", "app_user_id": U_SUB,
             "product_id": "standard_monthly", "store": "APP_STORE",
             "original_transaction_id": "otx-sub-1", "transaction_id": "otx-sub-1",
             "expiration_at_ms": 4102444800000, "currency": "USD", "price": 4.99}
st, body = post(sub_event)
check("HTTP 200", st, 200)
check("subscription active", sql(f"select status from billing_subscriptions where user_id='{U_SUB}'"), "active")
st, body = post({**sub_event, "type": "CANCELLATION", "id": "evt-s2",
                 "cancel_reason": "CUSTOMER_SUPPORT", "price": -4.99})
check("HTTP 200", st, 200)
check("status = refunded (access dropped now)", sql(f"select status from billing_subscriptions where user_id='{U_SUB}'"), "refunded")
check("NOT left as a period-end cancel", sql(f"select cancel_at_period_end from billing_subscriptions where user_id='{U_SUB}'"), "f")


sql("SET session_replication_role = replica; UPDATE system_flags SET sandbox_grants_enabled = false WHERE id = 1;")
st, body = post(pack_event(id="evt-8", user=U_SBX, transaction_id="SBX-1", environment="SANDBOX"))
check("HTTP 200 (acked, not retried)", st, 200)
check("ignored as sandbox", body.get("ignored"), "sandbox_grants_disabled")
check("no ledger row at all", sql(f"select count(*) from ai_credit_ledger where user_id='{U_SBX}'"), "0")

print("\n9) same event with the switch ON → grants, but tagged sandbox")
sql("SET session_replication_role = replica; UPDATE system_flags SET sandbox_grants_enabled = true WHERE id = 1;")
st, body = post(pack_event(id="evt-9", user=U_SBX, transaction_id="SBX-1", environment="SANDBOX"))
check("HTTP 200", st, 200)
check("reported as sandbox", body.get("environment"), "sandbox")
check("ledger environment = sandbox", sql(f"select environment from ai_credit_ledger where user_id='{U_SBX}' and delta>0"), "sandbox")

# NOTE: the admin_billing_overview sandbox-exclusion assertions live in
# sandbox_environment_test.sql — is_admin() needs a session-scoped JWT claim, and
# each sql() call here is a separate psql process, so the claim would not survive.
sql("SET session_replication_role = replica; UPDATE system_flags SET sandbox_grants_enabled = false WHERE id = 1;")

print("\n11) an event with NO environment field is treated as production")
st, body = post(pack_event(id="evt-11", user=U_PROD, transaction_id="PROD-1"))
check("defaults to production", body.get("environment"), "production")
check("ledger environment = production", sql(f"select environment from ai_credit_ledger where user_id='{U_PROD}' and delta>0"), "production")

# ── cleanup ────────────────────────────────────────────────────────────────
sql(f"""
SET session_replication_role = replica;
DELETE FROM ai_credit_ledger      WHERE user_id IN ({USER_LIST});
DELETE FROM ai_credit_balance     WHERE user_id IN ({USER_LIST});
DELETE FROM billing_subscriptions WHERE user_id IN ({USER_LIST});
DELETE FROM auth.users            WHERE id      IN ({USER_LIST});
""")

print("\n" + ("ALL PASS" if not fails else f"FAILURES: {fails}"))
