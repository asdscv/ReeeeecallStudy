-- Quiz stops being free. Owner decision, 2026-08-10.
--
-- Two allowances existed, both config on `ai_pricing_settings`:
--   free_quiz_units_per_day = 10  — a daily grant, reset every UTC day
--   quiz_trial_units        = 60  — a one-time grant, handed out on first visit to the quiz home
--
-- `_ai_quiz_allocate` spends trial first, then the day's free units, then the wallet, and both
-- `get_ai_quiz_quote` and `reserve_ai_quiz` call it — so setting both to zero makes every unit
-- paid through the same arithmetic that already quotes and charges. No function is redefined
-- here, which is the point: the free tier was a number, not a code path, and turning it off
-- should not be a chance to introduce a pricing bug.
--
-- The UI follows without a deploy. The trial banner renders on `trialUnits > 0`
-- (`QuizHomePage.tsx`, `QuizHomeScreen.tsx`) and the setup screen prints whatever
-- `get_ai_quiz_quote` returns, so a zero allowance simply stops being mentioned.
--
-- Grading multiple choice stays free and is untouched: `ai_quiz_price_units` has no
-- `grade_mcq` row, and an action absent from that table cannot be reserved at all.

-- ── New accounts ────────────────────────────────────────────────────────────
ALTER TABLE public.ai_pricing_settings
  ALTER COLUMN free_quiz_units_per_day SET DEFAULT 0,
  ALTER COLUMN quiz_trial_units        SET DEFAULT 0;

-- ── The live row ────────────────────────────────────────────────────────────
UPDATE public.ai_pricing_settings
   SET free_quiz_units_per_day = 0,
       quiz_trial_units        = 0
 WHERE id = 1;

-- ── Allowances already handed out ───────────────────────────────────────────
--
-- Without this, everyone who has already opened the quiz home keeps up to 60 units and the
-- change reads as "free for existing users, paid for new ones" — which is not what was asked
-- for, and is the harder of the two to explain later.
--
-- `units_remaining` is the unspent balance only. In-flight reservations are held in
-- `quiz_trial_held` on the job row and settled from there, so a generation running right now
-- still completes and still settles correctly.
UPDATE public.ai_quiz_trial
   SET units_remaining = 0
 WHERE units_remaining > 0;

COMMENT ON COLUMN public.ai_pricing_settings.free_quiz_units_per_day IS
  'Quiz units granted per UTC day. 0 since 204 — quiz is paid. Raising it re-opens a free tier with no code change.';
COMMENT ON COLUMN public.ai_pricing_settings.quiz_trial_units IS
  'One-time quiz trial units for a new account. 0 since 204 — quiz is paid.';
