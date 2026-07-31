-- ============================================================================
-- Down migration for 176_enrichment_attempt_provenance
-- For local/dev rollback. Not auto-applied; run manually if needed.
--
-- Restores mig 168's 12-argument `persist_ai_remediation` and drops the attempt column.
-- DESTRUCTIVE: dropping the column discards which failure each stored explanation was
-- grounded in. That data cannot be recovered from `request_fingerprint`, which is a
-- 128-char truncation. Only run this on a database you are willing to lose that on.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.persist_ai_remediation(
  uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.persist_ai_remediation(
  p_user_id uuid,
  p_action text,
  p_content jsonb,
  p_source_refs uuid[] DEFAULT '{}'::uuid[],
  p_goal_id uuid DEFAULT NULL,
  p_concept_id uuid DEFAULT NULL,
  p_card_id uuid DEFAULT NULL,
  p_activity_id uuid DEFAULT NULL,
  p_request_fingerprint text DEFAULT NULL,
  p_model_version text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_prompt_version text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_action NOT IN ('explain','compare','hint','generate','evaluate','recommend')
     OR p_content IS NULL OR jsonb_typeof(p_content) <> 'object'
     OR octet_length(p_content::text) > 65536 THEN
    RAISE EXCEPTION 'Invalid remediation payload' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_goals
    WHERE id = p_goal_id AND user_id = p_user_id AND status <> 'archived'
  ) THEN
    RAISE EXCEPTION 'Goal ownership mismatch' USING errcode = '42501';
  END IF;
  IF p_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_activities
    WHERE id = p_activity_id AND (owner_user_id = p_user_id OR owner_user_id IS NULL)
  ) THEN RAISE EXCEPTION 'Activity not accessible' USING errcode = '42501'; END IF;
  IF p_card_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM cards c JOIN decks d ON d.id = c.deck_id
    WHERE c.id = p_card_id AND c.user_id = d.user_id AND (
      (d.user_id = p_user_id AND (
        public.get_active_card_threshold() IS NULL
        OR c.created_at <= public.get_active_card_threshold()
        OR (EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
            AND NOT COALESCE((SELECT count_official_cards FROM card_limit_settings WHERE id = 1), false))
      ))
      OR (EXISTS (
        SELECT 1 FROM deck_shares ds
        WHERE ds.deck_id = d.id AND ds.recipient_id = p_user_id
          AND ds.share_mode = 'subscribe' AND ds.status = 'active'
      ) AND public.is_subscribed_deck_active(d.id))
    )
  ) THEN RAISE EXCEPTION 'Card not accessible' USING errcode = '42501'; END IF;
  IF p_concept_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_concepts c
    WHERE c.id = p_concept_id AND (
      c.owner_user_id = p_user_id OR (
        c.owner_user_id IS NULL AND p_goal_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM learning_goal_concepts gc
          WHERE gc.goal_id = p_goal_id AND gc.concept_id = c.id
        )
      )
    )
  ) THEN RAISE EXCEPTION 'Concept not accessible' USING errcode = '42501'; END IF;

  INSERT INTO user_enrichments
    (user_id, goal_id, concept_id, card_id, activity_id, action, request_fingerprint,
     content, source_references, model_version, provider, prompt_version, status)
  VALUES
    (p_user_id, p_goal_id, p_concept_id, p_card_id, p_activity_id, p_action,
     NULLIF(left(COALESCE(p_request_fingerprint, ''), 128), ''), p_content,
     to_jsonb(COALESCE(p_source_refs, '{}'::uuid[])), left(p_model_version, 200), left(p_provider, 100),
     left(p_prompt_version, 100), 'preview')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_ai_remediation(
  uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_ai_remediation(
  uuid, text, jsonb, uuid[], uuid, uuid, uuid, uuid, text, text, text, text)
  TO service_role;

DROP INDEX IF EXISTS idx_user_enrichments_attempt;
-- ALTER TABLE **IF EXISTS**: backing out a half-applied rollout must not itself fail. The
-- learning dry run reverts this chain twice, and the second pass runs after 165's rollback
-- has already dropped user_enrichments — a plain ALTER TABLE would abort there.
ALTER TABLE IF EXISTS user_enrichments DROP COLUMN IF EXISTS attempt_id;

COMMIT;
