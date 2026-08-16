-- Rollback 235: the analytics page goes back to pulling the whole library into the browser.
--
-- Drops both aggregates. `my_card_schedule` (232) survives, so the page can still call it — and
-- will still be cancelled by the statement timeout on any library big enough to matter.
DROP FUNCTION IF EXISTS public.my_review_progress(integer);
DROP FUNCTION IF EXISTS public.my_retention_curve();
