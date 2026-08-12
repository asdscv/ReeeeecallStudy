-- 215: the rates I seeded in 214 were wrong, and wrong in the direction that hides it.
--
-- 214 added a row for `gemini-3.1-flash-lite` at 100,000 / 400,000 micro-USD per Mtok, seeded
-- from its predecessor `gemini-2.5-flash-lite` on the reasoning that a successor in the same
-- product tier would be priced like it. The note on the row said to confirm against Google's
-- published list. Confirmed today, from https://ai.google.dev/gemini-api/docs/pricing:
--
--     gemini-2.5-flash-lite    $0.10 in  /  $0.40 out
--     gemini-3.1-flash-lite    $0.25 in  /  $1.50 out     <- 2.5x and 3.75x, not the same
--     gemini-2.5-flash         $0.30 in  /  $2.50 out
--
-- "lite" stopped meaning cheap in the 3.x line. The seeded row therefore under-recorded cost by
-- 2.5x on input and 3.75x on output, which is the dangerous direction: margin reports read
-- healthier than reality, and the actual-cost charge paths under-charged rather than over-,
-- so nothing looked wrong. 214 caught a 43x overcharge because it was loud; this one was quiet.
--
-- `gemini-flash-lite-latest` is an ALIAS and does not appear on the price list at all — its
-- rate is whatever Google currently points it at. Priced here at the 3.1 rate, which is what it
-- most likely resolves to today, and flagged: an alias whose price can move without notice is
-- the wrong thing to have in a chain that a fixed per-action price depends on. It should be
-- replaced with a pinned model id, which is a code change and not this migration's business.
BEGIN;

INSERT INTO public.ai_pricing_config (provider, model, in_micro_usd_per_mtok, out_micro_usd_per_mtok, note)
VALUES
  ('gemini', 'gemini-3.1-flash-lite', 250000, 1500000,
   'verified 2026-08-12 against ai.google.dev/gemini-api/docs/pricing'),
  ('gemini', 'gemini-flash-lite-latest', 250000, 1500000,
   'ALIAS — not on the price list; assumed to resolve to gemini-3.1-flash-lite. Replace with a pinned id.'),
  ('gemini', 'gemini-flash-latest', 300000, 2500000,
   'ALIAS — not on the price list; assumed to resolve to the flash tier. Replace with a pinned id.')
ON CONFLICT DO NOTHING;

-- `_ai_resolve_rate` reads the newest `effective_from` for a (provider, model), so the rows
-- above supersede 214's without deleting them — the old rate stays as history for any ledger
-- row that was priced under it.

COMMIT;
