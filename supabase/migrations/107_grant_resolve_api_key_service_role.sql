-- ============================================================================
-- 107: restore service_role EXECUTE on resolve_api_key (H4 collateral fix).
--
-- mig 098 did `REVOKE EXECUTE ON FUNCTION resolve_api_key(text) FROM anon,
-- authenticated, PUBLIC` to stop clients enumerating API keys. But REVOKE FROM
-- PUBLIC also stripped service_role's implicit EXECUTE, and the REST API Edge
-- function (`supabase/functions/api`) calls resolve_api_key as service_role to
-- authenticate `rc_...` keys. So the API's own auth is currently broken
-- (resolve_api_key → permission denied → every request 401s as INVALID_API_KEY).
--
-- This GRANTs EXECUTE back to service_role ONLY (the Edge function's role),
-- keeping anon/authenticated revoked (the mig 098 security goal — clients still
-- cannot call it directly). This does NOT expose the API to the internet: the
-- function is additionally gated at the platform layer (verify_jwt), so a raw
-- `rc_` key in Authorization is still rejected by the gateway. This only makes
-- the API's internal key resolution correct for when it is enabled.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.resolve_api_key(text) TO service_role;
