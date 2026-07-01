-- ============================================================================
-- 112: AI-generation cost + margin + pricing layer (economic source of truth).
--
-- Captures the REAL provider cost of each generation (from the token usage the
-- provider returns and we previously discarded), computes a WON price + realized
-- MARGIN, and makes rates/margin/FX tunable per (provider, model) WITHOUT a code
-- edit or redeploy (config rows + admin RPCs).
--
-- PURELY ADDITIVE: the live charging path (record_ai_generation / record_ai_image
-- / refund_ai_job, migs 108–111) is UNTOUCHED. Credits stay FIXED (1/card,
-- 5/image). This layer only *observes* — a finalize_ai_cost failure can never
-- change what a user was charged. Design of record: DOCS/TODO/AI-COST-MARGIN-DESIGN.md.
--
-- Depends on 111: ai_generation_jobs(id, user_id, credits, refunded), is_admin().
-- All money math is in micro-units (bigint) → no floating-point drift.
-- ============================================================================

-- ── 1) Business knobs — single editable row, owner-tuned (no migration to change) ──
CREATE TABLE IF NOT EXISTS public.ai_pricing_settings (
  id                     smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  won_per_credit         integer     NOT NULL DEFAULT 100,        -- ₩ / credit (MUST mirror the IAP/PortOne SKU)
  target_margin_bps      integer     NOT NULL DEFAULT 7000,       -- 70% floor (monitor/alert only, never blocks)
  usd_won_rate           numeric     NOT NULL DEFAULT 1350,       -- ₩ / USD
  fallback_in_micro_usd  bigint      NOT NULL DEFAULT 5000000,    -- $5.00 / 1M tokens (pessimistic default)
  fallback_out_micro_usd bigint      NOT NULL DEFAULT 15000000,   -- $15.00 / 1M tokens
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_pricing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ai_pricing_settings ENABLE ROW LEVEL SECURITY;  -- deny-all; readers are SECURITY DEFINER

-- ── 2) Per provider+model rate, effective-dated (history preserved). micro-USD / 1M tokens ──
CREATE TABLE IF NOT EXISTS public.ai_pricing_config (
  id                     bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider               text        NOT NULL,
  model                  text        NOT NULL,
  in_micro_usd_per_mtok  bigint      NOT NULL,   -- prompt (input) tokens
  out_micro_usd_per_mtok bigint      NOT NULL,   -- completion (output) tokens
  effective_from         timestamptz NOT NULL DEFAULT now(),
  note                   text
);
CREATE INDEX IF NOT EXISTS ai_pricing_config_lookup
  ON public.ai_pricing_config (provider, model, effective_from DESC);
ALTER TABLE public.ai_pricing_config ENABLE ROW LEVEL SECURITY;  -- deny-all; resolver is DEFINER

-- Seed INDICATIVE list prices (micro-USD / 1M tokens) — owner verifies vs real invoices.
INSERT INTO public.ai_pricing_config (provider, model, in_micro_usd_per_mtok, out_micro_usd_per_mtok, note) VALUES
  ('gemini',   'gemini-2.5-flash-lite',       100000,   400000, 'seed: indicative list price'),
  ('gemini',   'gemini-2.5-flash',            300000,  2500000, 'seed: indicative list price'),
  ('xai',      'grok-3',                     3000000, 15000000, 'seed: indicative list price'),
  ('openai',   'gpt-4.1-mini',                400000,  1600000, 'seed: indicative list price'),
  ('deepseek', 'deepseek-chat',               270000,  1100000, 'seed: indicative list price');

-- ── 3) Config-function seams (established _ai_* idiom; STABLE DEFINER, REVOKEd) ──
CREATE OR REPLACE FUNCTION public._ai_won_per_credit() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT won_per_credit FROM ai_pricing_settings WHERE id = 1 $$;
CREATE OR REPLACE FUNCTION public._ai_target_margin_bps() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT target_margin_bps FROM ai_pricing_settings WHERE id = 1 $$;
CREATE OR REPLACE FUNCTION public._ai_usd_won_rate() RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT usd_won_rate FROM ai_pricing_settings WHERE id = 1 $$;
CREATE OR REPLACE FUNCTION public._ai_resolve_rate(p_provider text, p_model text)
  RETURNS TABLE (in_rate bigint, out_rate bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT in_micro_usd_per_mtok, out_micro_usd_per_mtok
    FROM ai_pricing_config
    WHERE provider = p_provider AND model = p_model AND effective_from <= now()
    ORDER BY effective_from DESC, id DESC LIMIT 1  -- id DESC = deterministic on same-txn re-price ties
  $$;
REVOKE EXECUTE ON FUNCTION public._ai_won_per_credit()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_target_margin_bps()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_usd_won_rate()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ai_resolve_rate(text, text)  FROM PUBLIC, anon, authenticated;

-- ── 4) Economic ledger — 1 row per metered call that REACHED the provider ──
CREATE TABLE IF NOT EXISTS public.ai_cost_ledger (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_ref           text        NOT NULL UNIQUE REFERENCES public.ai_generation_jobs(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL,
  provider          text,
  model             text,
  tokens_in         integer     NOT NULL DEFAULT 0,
  tokens_out        integer     NOT NULL DEFAULT 0,
  cost_usd_micros   bigint,               -- NULL when usage unknown (estimated). Kept for invoice reconciliation.
  cost_won_micros   bigint,               -- NULL when usage unknown
  price_won_micros  bigint      NOT NULL, -- credits * won_per_credit * 1e6 (0 for free / template / deck)
  margin_won_micros bigint,               -- price - cost (NULL when cost unknown)
  margin_bps        integer,              -- NULL when price=0 (free CAC) or cost unknown
  rate_missing      boolean     NOT NULL DEFAULT false,   -- usage known but no rate row → fallback rate used
  estimated         boolean     NOT NULL DEFAULT false,   -- provider omitted usage → cost unknown
  under_target      boolean     NOT NULL DEFAULT false,   -- margin_bps < target (cheap alerting scan)
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_cost_ledger_model_time
  ON public.ai_cost_ledger (provider, model, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_cost_ledger_under_target
  ON public.ai_cost_ledger (created_at DESC) WHERE under_target;
ALTER TABLE public.ai_cost_ledger ENABLE ROW LEVEL SECURITY;  -- deny-all; RPC-only

-- ── 5) finalize_ai_cost — POST-generation cost recording. service_role/admin only ──
-- Idempotent on job_ref; fail-safe on missing usage (estimated) or missing rate
-- (pessimistic fallback). Decoupled from charging — never affects what was charged.
CREATE OR REPLACE FUNCTION public.finalize_ai_cost(
    p_user_id uuid, p_job_ref text, p_provider text, p_model text,
    p_tokens_in integer, p_tokens_out integer)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  j public.ai_generation_jobs%ROWTYPE;
  s public.ai_pricing_settings%ROWTYPE;
  v_in bigint; v_out bigint; v_missing boolean := false;
  v_cost_usd bigint; v_cost_won bigint; v_price bigint; v_margin bigint; v_bps integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to finalize cost' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_job_ref IS NULL THEN RETURN; END IF;

  SELECT * INTO j FROM ai_generation_jobs WHERE id = p_job_ref AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN; END IF;                            -- unknown / foreign job → no-op
  SELECT * INTO s FROM ai_pricing_settings WHERE id = 1;
  v_price := j.credits::bigint * s.won_per_credit * 1000000;   -- 0 when credits = 0 (free / template / deck)

  -- No usable usage → record an HONEST "unknown", never a faked 0-cost/100%-margin.
  -- Covers NULL, negative, AND (0,0) (a provider/gateway that reports zeros).
  IF p_tokens_in IS NULL OR p_tokens_out IS NULL OR p_tokens_in < 0 OR p_tokens_out < 0
     OR (p_tokens_in + p_tokens_out) = 0 THEN
    INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
        cost_usd_micros, cost_won_micros, price_won_micros, margin_won_micros, margin_bps,
        rate_missing, estimated, under_target)
    VALUES (p_job_ref, p_user_id, p_provider, p_model, 0, 0,
        NULL, NULL, v_price, NULL, NULL, false, true, false)
    ON CONFLICT (job_ref) DO NOTHING;
    RETURN;
  END IF;

  SELECT in_rate, out_rate INTO v_in, v_out FROM _ai_resolve_rate(p_provider, p_model);
  IF NOT FOUND OR v_in IS NULL THEN                            -- no rate row → conservative fallback
    v_in := s.fallback_in_micro_usd; v_out := s.fallback_out_micro_usd; v_missing := true;
  END IF;

  v_cost_usd := (p_tokens_in::bigint * v_in + p_tokens_out::bigint * v_out) / 1000000;  -- micro-USD
  v_cost_won := round(v_cost_usd * s.usd_won_rate)::bigint;                              -- micro-₩
  v_margin   := v_price - v_cost_won;
  v_bps      := CASE WHEN v_price > 0 THEN (v_margin * 10000 / v_price)::integer END;

  INSERT INTO ai_cost_ledger (job_ref, user_id, provider, model, tokens_in, tokens_out,
      cost_usd_micros, cost_won_micros, price_won_micros, margin_won_micros, margin_bps,
      rate_missing, estimated, under_target)
  VALUES (p_job_ref, p_user_id, p_provider, p_model, p_tokens_in, p_tokens_out,
      v_cost_usd, v_cost_won, v_price, v_margin, v_bps,
      v_missing, false, (v_bps IS NOT NULL AND v_bps < s.target_margin_bps))
  ON CONFLICT (job_ref) DO NOTHING;                            -- idempotent (edge retry / at-least-once)
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finalize_ai_cost(uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_ai_cost(uuid, text, text, text, integer, integer)
  TO service_role;

-- ── 6) Admin config RPCs — data-only re-pricing, no migration / deploy ──
CREATE OR REPLACE FUNCTION public.set_ai_pricing_rate(
    p_provider text, p_model text, p_in_micro_usd bigint, p_out_micro_usd bigint, p_note text DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  IF p_provider IS NULL OR p_model IS NULL OR p_in_micro_usd IS NULL OR p_out_micro_usd IS NULL
     OR p_in_micro_usd < 0 OR p_out_micro_usd < 0 THEN
    RAISE EXCEPTION 'Invalid rate' USING errcode = 'invalid_parameter_value';
  END IF;
  INSERT INTO ai_pricing_config (provider, model, in_micro_usd_per_mtok, out_micro_usd_per_mtok, note)
  VALUES (p_provider, p_model, p_in_micro_usd, p_out_micro_usd, p_note);
END;
$$;
CREATE OR REPLACE FUNCTION public.set_ai_pricing_settings(
    p_won_per_credit integer DEFAULT NULL, p_target_margin_bps integer DEFAULT NULL,
    p_usd_won_rate numeric DEFAULT NULL)
  RETURNS public.ai_pricing_settings
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.ai_pricing_settings;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  -- Sane bounds (defense-in-depth vs an admin fat-finger; upper caps also keep
  -- the micro-unit bigint margin math far from overflow).
  IF (p_won_per_credit IS NOT NULL AND (p_won_per_credit <= 0 OR p_won_per_credit > 1000000))
     OR (p_target_margin_bps IS NOT NULL AND (p_target_margin_bps < 0 OR p_target_margin_bps > 10000))
     OR (p_usd_won_rate IS NOT NULL AND (p_usd_won_rate <= 0 OR p_usd_won_rate > 100000)) THEN
    RAISE EXCEPTION 'Invalid setting' USING errcode = 'invalid_parameter_value';
  END IF;
  UPDATE ai_pricing_settings SET
    won_per_credit    = COALESCE(p_won_per_credit, won_per_credit),
    target_margin_bps = COALESCE(p_target_margin_bps, target_margin_bps),
    usd_won_rate      = COALESCE(p_usd_won_rate, usd_won_rate),
    updated_at        = now()
  WHERE id = 1 RETURNING * INTO r;
  RETURN r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_ai_pricing_rate(text, text, bigint, bigint, text)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_ai_pricing_settings(integer, integer, numeric)      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_ai_pricing_rate(text, text, bigint, bigint, text)    TO service_role;
GRANT  EXECUTE ON FUNCTION public.set_ai_pricing_settings(integer, integer, numeric)       TO service_role;

-- ── 7) Monitoring rollup — admin/service_role only (business-sensitive margins) ──
-- Includes ALL rows in the day/model group, but the cost/margin SUMS cover only
-- non-estimated rows (never fakes 100% margin on unknown cost); refunded success
-- counts as price 0 (a comped loss). Estimated/rate-missing surfaced as counts.
CREATE OR REPLACE FUNCTION public.get_ai_margin_daily(
    p_since date DEFAULT (now() - interval '30 days')::date)
  RETURNS TABLE (day date, provider text, model text, jobs bigint,
                 unknown_cost_jobs bigint, rate_missing_jobs bigint,
                 price_won_micros numeric, cost_won_micros numeric,
                 margin_won_micros numeric, realized_margin_ratio numeric)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT
    date_trunc('day', l.created_at)::date AS day,
    l.provider, l.model,
    count(*)::bigint,
    count(*) FILTER (WHERE l.estimated)::bigint,
    count(*) FILTER (WHERE l.rate_missing)::bigint,
    COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
             FILTER (WHERE NOT l.estimated), 0)::numeric,
    COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0)::numeric,
    (COALESCE(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
              FILTER (WHERE NOT l.estimated), 0)
     - COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0))::numeric,
    round(1.0 - (COALESCE(sum(l.cost_won_micros) FILTER (WHERE NOT l.estimated), 0))::numeric
          / NULLIF(sum(CASE WHEN j.refunded THEN 0 ELSE l.price_won_micros END)
                   FILTER (WHERE NOT l.estimated), 0), 4)
  FROM ai_cost_ledger l JOIN ai_generation_jobs j ON j.id = l.job_ref
  WHERE l.created_at::date >= p_since
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 2, 3;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_margin_daily(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_margin_daily(date) TO authenticated, service_role;  -- is_admin() gate in-fn
