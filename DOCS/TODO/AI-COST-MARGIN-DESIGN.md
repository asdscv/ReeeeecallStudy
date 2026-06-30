<!-- Design of record. Produced by the `ai-cost-margin-design` multi-agent workflow
(4 independent approaches → synthesis), grounded in the live code (migs 108-111, edge fn,
ai-providers.ts). Tracked from DOCS/TODO/AI-MONETIZATION-REMAINING.md §1. NOT YET BUILT. -->

# AI-generation cost + margin + pricing layer — design of record (mig 112)

## 1. Recommendation

Adopt **Design 4's cost-ledger-of-record backbone** — a dedicated, append-only `ai_cost_ledger` written *after* generation, keyed 1:1 on the existing `job_ref` — and graft onto it **Design 3's config-function seams** (`_ai_won_per_credit()`, `_ai_target_margin_bps()`, `_ai_usd_won_rate()` in the established `_ai_*` idiom) and **Design 2's operational hygiene** (single-row settings table, conservative fallback rate, `rate_missing`/`estimated`/`under_target` flags for cheap alerting). Credits stay **fixed** (1/card, 5/image) — I explicitly **reject Design 1's hold-then-settle dynamic charging**: IAP/PortOne sell fixed-WON credit packs, per-call variable pricing is unsellable and breaks the `getAffordableCards` pre-generation quote, and the runtime fact that `record_ai_generation` runs *before* the provider call (it gates spend) means it structurally cannot know tokens. The trade-off I optimized for is **predictable user pricing + IAP compatibility + decision-free observability**, accepting that a pathological single call can run below target margin between a cost spike and an ops re-price — bounded and surfaced by the daily margin view, not by per-call repricing. The economic layer is **purely additive**: it never touches the `record_ai_generation` / `record_ai_image` / `refund_ai_job` charging path, so it ships with zero risk to live metering.

## 2. Cost capture

Every provider in the registry returns an OpenAI-compatible `usage` object; today it's discarded at `ai-generate/index.ts:163-166` (only `choices[0].message.content` is read). Thread it out:

**`providerRequest` (`index.ts:116`, return point `:163-166`)** — change return type to `Promise<{ content: string; usage: TokenUsage | null }>`:
```ts
interface TokenUsage { prompt_tokens: number; completion_tokens: number }
// ...at :163-166
const data = await res.json() as Record<string, any>
const content = data.choices?.[0]?.message?.content
if (!content) throw new Error('PROVIDER_EMPTY')
const u = data.usage
const usage = (u && Number.isFinite(Number(u.prompt_tokens)) && Number.isFinite(Number(u.completion_tokens)))
  ? { prompt_tokens: Number(u.prompt_tokens), completion_tokens: Number(u.completion_tokens) }
  : null
return { content: content as string, usage }
```

**`generate` (`index.ts:172-182`)** — propagate; on the strict-retry second call you paid for **both** requests, so SUM:
```ts
const sumUsage = (a: TokenUsage|null, b: TokenUsage|null): TokenUsage|null =>
  (a||b) ? { prompt_tokens:(a?.prompt_tokens??0)+(b?.prompt_tokens??0),
             completion_tokens:(a?.completion_tokens??0)+(b?.completion_tokens??0) } : null
async function generate(m, sys, user, img?): Promise<{ json: Record<string,unknown>; usage: TokenUsage|null }> {
  const a = await providerRequest(m, sys, user, img)
  try { return { json: JSON.parse(stripMarkdownFences(a.content)), usage: a.usage } }
  catch {
    const strict = sys + '\n\nIMPORTANT: You MUST respond with valid JSON only...'
    const b = await providerRequest(m, strict, user, img)
    return { json: JSON.parse(stripMarkdownFences(b.content)), usage: sumUsage(a.usage, b.usage) }
  }
}
```

**EXACT integration points** — cost is a *second, post-generation* write, keyed on the `job_ref` that `record_ai_generation`/`record_ai_image` already returns. Add a `finalizeCost` helper mirroring `refundJob` (`index.ts:80-91`, same `sbServiceRole()` client at `:67-72`, same await-and-inspect-error pattern — no `.catch` on the thenable, per the note at `:74-79`):

```ts
async function finalizeCost(userId: string, jobRef: string|undefined, m: ResolvedModel, usage: TokenUsage|null): Promise<void> {
  if (!jobRef) return
  try {
    const { error } = await sbServiceRole().rpc('finalize_ai_cost', {
      p_user_id: userId, p_job_ref: jobRef,
      p_provider: m.provider, p_model: m.model,          // m.provider ALREADY exists (ai-providers.ts:60,79)
      p_tokens_in: usage?.prompt_tokens ?? null,
      p_tokens_out: usage?.completion_tokens ?? null,
    })
    if (error) console.error('[ai-generate] cost finalize failed (job', jobRef, '):', error.message)
  } catch (e) { console.error('[ai-generate] cost finalize threw (job', jobRef, '):', e) }
}
```

- **Vision success** — `index.ts:301-303`. The metering call `record_ai_image()` is at `:291` (gives `imgMeter.job_ref`). Replace `:302-303`:
  ```ts
  const { json: content, usage } = await generate(model, iSys, iUser, image)
  await finalizeCost(userId, imgMeter.job_ref, model, usage)   // best-effort, never throws
  return json({ content, balance: imgMeter.balance ?? null }, 200, cors)
  ```
- **Text success** — `record_ai_generation` is at `:346-349` (gives `meter.job_ref`); `generate` at `:371`; the 200 at `:383`. Capture usage from `generate`, then before `:383`:
  ```ts
  const gen = await generate(model, systemPrompt, userPrompt)   // {json, usage}
  // ...catch branch unchanged: refundJob(userId, meter.job_ref) on failure...
  await finalizeCost(userId, meter.job_ref, model, gen.usage)
  return json({ content: gen.json, remainingFree }, 200, cors)
  ```

`finalizeCost` is best-effort and must never mask the 200 (its try/catch guarantees this). It is `await`ed (one cheap RPC) so capture is guaranteed; if the added latency matters, wrap as `EdgeRuntime.waitUntil(finalizeCost(...))`. **Rates never ship in edge code** — the edge fn passes only `(provider, model, tokens_in, tokens_out)`; cost/price/margin are computed in SQL.

## 3. Pricing & credits — FIXED (decisive)

- **Credit → WON:** one settings knob `_ai_won_per_credit()` (default ₩100), which **must mirror the IAP/PortOne SKU**. The price of a job is `price = credits × won_per_credit`, where `credits` is the value `ai_generation_jobs.credits` already recorded by mig 111 (paid credits for text; flat 5 for image; `0` for free cards / template / deck). Cost↔price are therefore always consistent because both derive from the same job row.
- **Setting price ≥ cost × (1+margin):** the system does **not** auto-enforce per call. It *records* real `cost` and *computes* `realized_margin = 1 − cost/price`, compares to `target_margin_bps`, and surfaces drift. The owner holds `price ≥ cost×(1+margin)` by choosing `won_per_credit` and the credit-per-unit rates against observed per-model cost, and by switching the env model when a provider gets too expensive (the cost layer auto-reprices a model swap because it keys on `(provider, model)`).
- **Fixed vs dynamic — FIXED, final.** Reasons: (1) IAP/PortOne credit packs are fixed-WON SKUs — fractional per-call charges are unsellable and fail store review; (2) credits are pre-purchased and `getAffordableCards` (`server-client.ts:122-127`) quotes a deterministic cost *before* generating — dynamic charging retroactively invalidates the quote the user already saw; (3) tokens are only known *after* the call, so a pre-gate dynamic charge is impossible without Design 1's hold-then-settle, whose transient "estimated, finalizing" wallet UX is not worth it given fixed packs absorb cost variance into the margin buffer. Cost variance is reconciled **offline** by re-pricing config, not online per call.

## 4. Margin

- **Per-transaction:** every successful job writes one `ai_cost_ledger` row carrying `cost_usd_micros`, `cost_won_micros`, `price_won_micros`, `margin_won_micros`, `margin_bps`, and the boolean flags `rate_missing` / `estimated` / `under_target`.
- **Aggregate:** view `ai_margin_daily` rolls up by `(day, provider, model)` → `sum(price)`, `sum(cost)`, `realized_margin_ratio`, plus `unknown_cost_jobs` (estimated) and `rate_missing_jobs` blind-spot counts. It **excludes `estimated` rows** from the margin math (never fakes 100% margin on missing usage) and treats `refunded` jobs as `price=0` (a comped success is a real loss).
- **Target + alert seam:** `_ai_target_margin_bps()` (default 7000 = 70%) is the floor; `under_target` is stamped per row (`margin_bps < target`) with a partial index for cheap scans. **pg_cron is not installed** (per security audit), so the alert rides the existing **Cloudflare daily-cron worker** (or a GitHub Action): query `get_ai_margin_daily`, ping when `realized_margin_ratio < target` for any model or when `unknown_cost_jobs / jobs` exceeds a threshold. An admin dashboard card reads the same RPC (matches the `admin-store → RPC → admin-stats` idiom).
- **Free-tier subtlety (intentional):** a mixed batch charges `credits` for the *paid* cards only, but `cost` covers tokens for **all** cards generated (free + paid). The resulting thin/negative margin on that row is the true picture — free-tier card cost is genuine CAC and shows up exactly where it should. Pure-free / template / deck jobs have `price=0` → `margin_bps=NULL`, segregated from paid-margin stats so they don't poison the ratio.

## 5. Schema + migration sketch (`supabase/migrations/112_ai_cost_margin.sql`)

```sql
-- 112_ai_cost_margin.sql — economic source-of-truth for AI generation.
-- Captures per-job provider COST, computes WON price + realized MARGIN.
-- Credits/charging stay FIXED & UNCHANGED (108-111). Re-pricing is config-only (no deploy).
-- Depends on 111: ai_generation_jobs(id, user_id, credits, refunded), is_admin().
BEGIN;

-- 1) Business knobs — single editable row, owner-tuned (no migration to change).
CREATE TABLE public.ai_pricing_settings (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  won_per_credit         integer NOT NULL DEFAULT 100,       -- ₩ / credit (MUST mirror IAP SKU)
  target_margin_bps      integer NOT NULL DEFAULT 7000,      -- 70% floor (monitor only)
  usd_won_rate           numeric NOT NULL DEFAULT 1350,      -- ₩ / USD
  fallback_in_micro_usd  bigint  NOT NULL DEFAULT 5000000,   -- $5.00 /Mtok (pessimistic)
  fallback_out_micro_usd bigint  NOT NULL DEFAULT 15000000,  -- $15.00 /Mtok
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_pricing_settings (id) VALUES (1);
ALTER TABLE public.ai_pricing_settings ENABLE ROW LEVEL SECURITY;  -- deny-all; readers are DEFINER

-- 2) Per provider+model rate, effective-dated (history preserved). micro-USD / 1M tokens.
CREATE TABLE public.ai_pricing_config (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider               text NOT NULL,
  model                  text NOT NULL,
  in_micro_usd_per_mtok  bigint NOT NULL,   -- prompt tokens
  out_micro_usd_per_mtok bigint NOT NULL,   -- completion tokens
  effective_from         timestamptz NOT NULL DEFAULT now(),
  note                   text
);
CREATE INDEX ai_pricing_config_lookup ON public.ai_pricing_config (provider, model, effective_from DESC);
ALTER TABLE public.ai_pricing_config ENABLE ROW LEVEL SECURITY;  -- deny-all; resolver is DEFINER

-- Seed list prices (micro-USD/Mtok) — INDICATIVE; owner verifies vs real invoices.
INSERT INTO public.ai_pricing_config (provider,model,in_micro_usd_per_mtok,out_micro_usd_per_mtok,note) VALUES
  ('gemini','gemini-2.5-flash-lite', 100000,  400000,'seed'),
  ('gemini','gemini-2.5-flash',      300000, 2500000,'seed'),
  ('xai',   'grok-3',               3000000,15000000,'seed'),
  ('openai','gpt-4.1-mini',          400000, 1600000,'seed'),
  ('deepseek','deepseek-chat',       270000, 1100000,'seed');

-- 3) Config seams (read the settings row; established _ai_* idiom; STABLE DEFINER, REVOKEd).
CREATE OR REPLACE FUNCTION public._ai_won_per_credit() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT won_per_credit FROM ai_pricing_settings WHERE id = 1 $$;
CREATE OR REPLACE FUNCTION public._ai_target_margin_bps() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT target_margin_bps FROM ai_pricing_settings WHERE id = 1 $$;
CREATE OR REPLACE FUNCTION public._ai_usd_won_rate() RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT usd_won_rate FROM ai_pricing_settings WHERE id = 1 $$;
CREATE OR REPLACE FUNCTION public._ai_resolve_rate(p_provider text, p_model text)
  RETURNS TABLE(in_rate bigint, out_rate bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT in_micro_usd_per_mtok, out_micro_usd_per_mtok FROM ai_pricing_config
   WHERE provider = p_provider AND model = p_model AND effective_from <= now()
   ORDER BY effective_from DESC LIMIT 1 $$;
REVOKE EXECUTE ON FUNCTION public._ai_won_per_credit()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_target_margin_bps()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_usd_won_rate()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_resolve_rate(text,text)     FROM PUBLIC, anon, authenticated;

-- 4) Economic ledger — 1 row per metered call that reached the provider. Idempotent on job_ref.
CREATE TABLE public.ai_cost_ledger (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_ref           text NOT NULL UNIQUE REFERENCES ai_generation_jobs(id),
  user_id           uuid NOT NULL,
  provider          text, model text,
  tokens_in         integer NOT NULL DEFAULT 0,
  tokens_out        integer NOT NULL DEFAULT 0,
  cost_usd_micros   bigint,            -- NULL = usage unknown (estimated). Kept for invoice reconciliation.
  cost_won_micros   bigint,            -- NULL = usage unknown
  price_won_micros  bigint NOT NULL,   -- credits * won_per_credit * 1e6 (0 for free/template/deck)
  margin_won_micros bigint,            -- price - cost (NULL when cost unknown)
  margin_bps        integer,           -- NULL when price=0 (free CAC) or cost unknown
  rate_missing      boolean NOT NULL DEFAULT false,
  estimated         boolean NOT NULL DEFAULT false,
  under_target      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_cost_ledger_model_time   ON public.ai_cost_ledger (provider, model, created_at DESC);
CREATE INDEX ai_cost_ledger_under_target ON public.ai_cost_ledger (created_at DESC) WHERE under_target;
ALTER TABLE public.ai_cost_ledger ENABLE ROW LEVEL SECURITY;  -- deny-all; RPC-only

-- 5) Finalize cost (post-generation). service_role/admin only. Idempotent. Fail-safe on missing data.
CREATE OR REPLACE FUNCTION public.finalize_ai_cost(
    p_user_id uuid, p_job_ref text, p_provider text, p_model text,
    p_tokens_in integer, p_tokens_out integer)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  j ai_generation_jobs%ROWTYPE; s ai_pricing_settings%ROWTYPE;
  v_in bigint; v_out bigint; v_missing boolean := false;
  v_cost_usd bigint; v_cost_won bigint; v_price bigint; v_margin bigint; v_bps integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501'; END IF;
  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;                          -- unknown/foreign job → no-op
  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  v_price := j.credits::bigint * s.won_per_credit * 1000000;  -- 0 when credits = 0

  IF p_tokens_in IS NULL OR p_tokens_out IS NULL THEN          -- provider omitted usage → honest "unknown"
    INSERT INTO ai_cost_ledger(job_ref,user_id,provider,model,tokens_in,tokens_out,
        cost_usd_micros,cost_won_micros,price_won_micros,margin_won_micros,margin_bps,
        rate_missing,estimated,under_target)
    VALUES (p_job_ref,p_user_id,p_provider,p_model,0,0,
        NULL,NULL,v_price,NULL,NULL,false,true,false)
    ON CONFLICT (job_ref) DO NOTHING;
    RETURN;
  END IF;

  SELECT in_rate,out_rate INTO v_in,v_out FROM _ai_resolve_rate(p_provider,p_model);
  IF NOT FOUND OR v_in IS NULL THEN                            -- absent rate → conservative fallback
    v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
  END IF;

  v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;
  v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;
  v_margin   := v_price - v_cost_won;
  v_bps      := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;

  INSERT INTO ai_cost_ledger(job_ref,user_id,provider,model,tokens_in,tokens_out,
      cost_usd_micros,cost_won_micros,price_won_micros,margin_won_micros,margin_bps,
      rate_missing,estimated,under_target)
  VALUES (p_job_ref,p_user_id,p_provider,p_model,p_tokens_in,p_tokens_out,
      v_cost_usd,v_cost_won,v_price,v_margin,v_bps,
      v_missing,false,(v_bps IS NOT NULL AND v_bps < s.target_margin_bps))
  ON CONFLICT (job_ref) DO NOTHING;                           -- idempotent (edge retry / at-least-once)
END; $$;
REVOKE EXECUTE ON FUNCTION public.finalize_ai_cost(uuid,text,text,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_ai_cost(uuid,text,text,text,integer,integer) TO service_role;

-- 6) Admin config RPCs — data-only re-pricing, no migration/deploy.
CREATE OR REPLACE FUNCTION public.set_ai_pricing_rate(
    p_provider text, p_model text, p_in_micro_usd bigint, p_out_micro_usd bigint, p_note text DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$ BEGIN
  IF NOT (auth.role() = 'service_role' OR is_admin()) THEN RAISE EXCEPTION 'Not authorized' USING errcode='42501'; END IF;
  INSERT INTO ai_pricing_config(provider,model,in_micro_usd_per_mtok,out_micro_usd_per_mtok,note)
  VALUES (p_provider,p_model,p_in_micro_usd,p_out_micro_usd,p_note);
END; $$;
CREATE OR REPLACE FUNCTION public.set_ai_pricing_settings(
    p_won_per_credit integer DEFAULT NULL, p_target_margin_bps integer DEFAULT NULL, p_usd_won_rate numeric DEFAULT NULL)
  RETURNS ai_pricing_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$ DECLARE r ai_pricing_settings; BEGIN
  IF NOT (auth.role() = 'service_role' OR is_admin()) THEN RAISE EXCEPTION 'Not authorized' USING errcode='42501'; END IF;
  UPDATE ai_pricing_settings SET
    won_per_credit    = COALESCE(p_won_per_credit, won_per_credit),
    target_margin_bps = COALESCE(p_target_margin_bps, target_margin_bps),
    usd_won_rate      = COALESCE(p_usd_won_rate, usd_won_rate),
    updated_at = now() WHERE id = 1 RETURNING * INTO r;
  RETURN r;
END; $$;
REVOKE EXECUTE ON FUNCTION public.set_ai_pricing_rate(text,text,bigint,bigint,text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_ai_pricing_settings(integer,integer,numeric)         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_ai_pricing_rate(text,text,bigint,bigint,text)        TO service_role;
GRANT  EXECUTE ON FUNCTION public.set_ai_pricing_settings(integer,integer,numeric)         TO service_role;

-- 7) Monitoring rollup (admin dashboard reads via the DEFINER RPC; refunded success = price 0 loss).
CREATE OR REPLACE FUNCTION public.get_ai_margin_daily(p_since date DEFAULT (now()-interval '30 days')::date)
  RETURNS TABLE(day date, provider text, model text, jobs bigint,
                unknown_cost_jobs bigint, rate_missing_jobs bigint,
                price_micros numeric, cost_micros numeric, margin_micros numeric, realized_margin_ratio numeric)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT date_trunc('day', l.created_at)::date, l.provider, l.model, count(*),
         count(*) FILTER (WHERE l.estimated), count(*) FILTER (WHERE l.rate_missing),
         sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END),
         sum(l.cost_won_micros),
         sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END) - sum(l.cost_won_micros),
         round(1.0 - sum(l.cost_won_micros)::numeric
               / NULLIF(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END),0), 4)
  FROM ai_cost_ledger l JOIN ai_generation_jobs j ON j.id = l.job_ref
  WHERE l.created_at::date >= p_since AND NOT l.estimated   -- exclude unknown-cost from margin math
  GROUP BY 1,2,3 ORDER BY 1 DESC, 2, 3;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_margin_daily(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_margin_daily(date) TO authenticated, service_role; -- is_admin() gate enforced in admin-store
COMMIT;
```

Notes: micro-units keep everything integer/`bigint` (no FP drift); `cost_usd_micros` is retained so provider USD invoices reconcile exactly while `cost_won_micros` drives margin. No overflow at realistic volumes (worst case ~1e9 micro-WON per row). If the admin dashboard must be `is_admin()`-gated for non-service callers, add an `IF NOT is_admin() THEN RAISE` guard inside `get_ai_margin_daily` (omitted above for brevity since the dashboard already gates).

## 6. Extensibility proof (no code edit, no redeploy)

- **Add a model on an existing provider** (e.g. switch env to `gemini-2.5-pro`): one row — `SELECT set_ai_pricing_rate('gemini','gemini-2.5-pro', 1250000, 10000000, 'pro tier');`. The cost layer keys purely on the `(provider, model)` strings `resolveModel` already returns, so the next call auto-prices. Zero code.
- **Add a new vendor** (e.g. Anthropic): `SELECT set_ai_pricing_rate('anthropic','claude-haiku-4', 250000, 1250000, NULL);` for pricing. The only code touch is *if* its HTTP base URL differs — that's one line in the `PROVIDERS` registry (`ai-providers.ts:24-50`), which is the pre-existing per-vendor seam, not new economic code.
- **Change target margin:** `SELECT set_ai_pricing_settings(p_target_margin_bps => 6500);` — one RPC, no migration, no redeploy.
- **Change ₩/credit (track an IAP SKU change):** `SELECT set_ai_pricing_settings(p_won_per_credit => 120);`.
- **Change FX:** `SELECT set_ai_pricing_settings(p_usd_won_rate => 1400);`.
- **Re-price a model** (provider raised list price): another `set_ai_pricing_rate(...)` INSERT — effective-dated, so historical cost rows keep their original snapshot rate and stay accurate.

## 7. Failure / edge handling

- **Provider failure:** `generate()` throws → the success branch (and `finalizeCost`) is never reached, and the existing `refundJob` (`index.ts:307` vision / `:378` text) reverses credits. No cost row is written — correct, no provider cost was incurred. Success and refund paths are mutually exclusive in the current edge fn, so no double-accounting.
- **Missing token usage** (provider omits `usage`): `p_tokens_in/out` arrive NULL → row written with `estimated=true`, `cost_*_micros=NULL` (honest unknown, **not** a faked 0/100% margin). `get_ai_margin_daily` excludes these from margin math and counts them as `unknown_cost_jobs` — your blind-spot share is visible. Never blocks the 200.
- **Absent rate row** (usage present, no `ai_pricing_config` match): falls back to the conservative `fallback_in/out_micro_usd` from settings and sets `rate_missing=true`. The fallback is intentionally *pessimistic* (high cost) so margin looks bad and you notice — the opposite failure (cost=0 → fake 100% margin) would silently lull. Surfaced as `rate_missing_jobs`.
- **Idempotency:** `ai_cost_ledger.job_ref` is `UNIQUE` and the insert is `ON CONFLICT (job_ref) DO NOTHING`, so an edge retry / at-least-once redelivery lands exactly one cost row. Cost recording is fully decoupled from charging — a `finalize_ai_cost` failure never affects what the user was charged.
- **Refund of an already-costed success** (admin/out-of-band): cost row stays (the provider cost was real); `get_ai_margin_daily` treats `refunded=true` as `price=0` → the comp shows up as a full loss, which is the truth.

## 8. Phased rollout

- **Phase 0 — cost capture + recording (build now, needs ZERO business numbers).** Edge-fn usage threading (`providerRequest`/`generate`/two `finalizeCost` call sites) + mig 112 (tables, config seams, `finalize_ai_cost`, admin RPCs, monitoring RPC) + seeded indicative rates + default FX. Ships pure observability: `cost_usd_micros` populates immediately, and you begin collecting real per-model cost data. The `won_per_credit=100` / `target_margin_bps=7000` defaults compute price/margin columns but you **ignore margin** in Phase 0 — cost capture is decision-free, and you cannot pick a sane WON/credit until you've seen real cost. Zero risk to live metering (charging path untouched).
- **Phase 1 — turn on margin (after the owner sets numbers).** `set_ai_pricing_settings` to the real IAP SKU ₩/credit and the chosen target margin; verify the seeded rates against the first real provider invoices (adjust via `set_ai_pricing_rate`); wire the admin dashboard card to `get_ai_margin_daily`; add the alert to the existing Cloudflare daily-cron worker (no pg_cron). Now `under_target` / realized-margin monitoring is live.
- **Phase 2 — optional, only if data demands it.** Per-card free/paid refund deltas; automated re-price suggestions; FX auto-update; and *only if* Phase-1 data shows intolerable per-call margin variance, revisit Design 1's hold-then-settle (deferred deliberately — its UX cost isn't justified while fixed packs absorb variance).

## 9. Open business decisions (owner must set)

1. **WON per credit** (`won_per_credit`) — must equal the IAP/PortOne credit-pack ₩/credit; also requires choosing the credit-pack tiers/SKUs themselves (a store decision upstream of this number).
2. **Target margin %** (`target_margin_bps`) — the monitored floor (default 7000 = 70%); drives alerting only, not blocking.
3. **Fixed vs dynamic** — recommended **fixed** and built that way; owner ratifies. (Reopen only if Phase-1 data shows fixed pricing bleeds on the expensive vision path.)
4. **Free-tier cost absorption** — keep the current 10 free cards/day as CAC? Set a daily free-CAC budget/cap, or accept uncapped? Plus the minor FX policy (static `usd_won_rate` vs periodic update) — recommended: update FX monthly via `set_ai_pricing_settings`, keep `cost_usd_micros` as the invoice-reconciliation source of truth.

---

**Files touched:** new `supabase/migrations/112_ai_cost_margin.sql`; `supabase/functions/ai-generate/index.ts` (usage threading at `:116`/`:163-166` and `:172-182`; `finalizeCost` helper beside `refundJob` `:80-91`; call sites at vision `:301-303` and text `:368-383`). **No change to** `supabase/functions/_shared/ai-providers.ts` — `ResolvedModel.provider` already exists (`:56-61, 79`). **No change to** the charging RPCs (`record_ai_generation` / `record_ai_image` / `refund_ai_job`).
