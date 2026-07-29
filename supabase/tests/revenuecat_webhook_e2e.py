#!/usr/bin/env python3
# ============================================================================
# revenuecat-webhook edge function — LOCAL end-to-end test for the CONSUMABLE
# credit-pack lifecycle (no RevenueCat account needed; events are synthesised).
#
# Drives the real function over HTTP and asserts what actually landed in
# ai_credit_ledger / ai_credit_balance:
#   * iOS + Android purchase   → grant keyed 'rc:<store txn>', platform stamped
#   * redelivery               → idempotent (granted once)
#   * REFUND                   → clawback reverses exactly the grant, balance 0
#   * REFUND redelivery        → idempotent (no double debit)
#   * REFUND *before* grant    → tombstone, and the late grant is REFUSED
#   * grant with no txn key    → 'rcev:<event id>' ref, NOT refund-matchable
#
# WHY IT EXISTS: the refund-before-grant guard (mig 134) read ai_credit_ledger
# directly, but that table is RPC-only, so the read answered 42501 on every call
# and the discarded error made the guard a no-op — credits were issued for
# already-refunded purchases. Nothing caught it until this test existed. mig 158
# routes the check through credit_grant_is_refunded() and fails closed.
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
sql(f"""
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('{U_IOS}'),('{U_AND}'),('{U_TOMB}'),('{U_NOTX}') ON CONFLICT DO NOTHING;
DELETE FROM ai_credit_ledger  WHERE user_id IN ('{U_IOS}','{U_AND}','{U_TOMB}','{U_NOTX}');
DELETE FROM ai_credit_balance WHERE user_id IN ('{U_IOS}','{U_AND}','{U_TOMB}','{U_NOTX}');
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

print("\n3) REFUND for that transaction → clawback reverses exactly the grant")
st, body = post(pack_event(type="REFUND", id="evt-2", user=U_IOS, transaction_id="1000000111"))
check("HTTP 200", st, 200)
check("reversal row written", sql(f"select count(*) from ai_credit_ledger where ref='refund:rc:1000000111'"), "1")
check("reversal amount = -grant", sql(f"select delta from ai_credit_ledger where ref='refund:rc:1000000111'"), f"-{grant_micro}")
check("balance back to zero", sql(f"select balance from ai_credit_balance where user_id='{U_IOS}'"), "0")

print("\n4) REFUND redelivered → idempotent, balance not double-debited")
post(pack_event(type="REFUND", id="evt-2b", user=U_IOS, transaction_id="1000000111"))
check("still ONE reversal", sql(f"select count(*) from ai_credit_ledger where ref='refund:rc:1000000111'"), "1")
check("balance still zero", sql(f"select balance from ai_credit_balance where user_id='{U_IOS}'"), "0")

print("\n5) Android purchase → same path, platform recorded as android")
st, body = post(pack_event(id="evt-3", user=U_AND, store="PLAY_STORE", transaction_id="GPA.3311-1111-2222-33333"))
check("platform stamped android", body.get("platform"), "android")
check("ledger platform = android", sql(f"select platform from ai_credit_ledger where user_id='{U_AND}' and delta>0"), "android")

print("\n6) REFUND arrives BEFORE the grant (out-of-order delivery)")
st, _ = post(pack_event(type="REFUND", id="evt-4", user=U_TOMB, transaction_id="1000000222"))
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
st, body = post({"type": "REFUND", "id": "evt-7", "app_user_id": U_NOTX,
                 "product_id": "ai_credit_099", "store": "APP_STORE"})
check("refund acked but cannot match", body.get("ignored"), "no_txn_key")
check("credits NOT clawed back (known gap)", sql(f"select balance from ai_credit_balance where user_id='{U_NOTX}'"), str(grant_micro))

# ── cleanup ────────────────────────────────────────────────────────────────
sql(f"""
SET session_replication_role = replica;
DELETE FROM ai_credit_ledger  WHERE user_id IN ('{U_IOS}','{U_AND}','{U_TOMB}','{U_NOTX}');
DELETE FROM ai_credit_balance WHERE user_id IN ('{U_IOS}','{U_AND}','{U_TOMB}','{U_NOTX}');
DELETE FROM auth.users        WHERE id      IN ('{U_IOS}','{U_AND}','{U_TOMB}','{U_NOTX}');
""")

print("\n" + ("ALL PASS" if not fails else f"FAILURES: {fails}"))
