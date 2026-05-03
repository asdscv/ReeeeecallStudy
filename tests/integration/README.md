# Integration Tests — Real Supabase

표준 준거: `DOCS/STANDARD/07_TESTING` "Real Docker 테스트 정책"

## Run locally

```bash
# 1. start local supabase (requires Docker)
supabase start

# 2. apply migrations to fresh DB
supabase db reset --no-seed

# 3. read keys from `supabase status`
export SUPABASE_LOCAL_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=$(supabase status -o json | jq -r .ANON_KEY)
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)

# 4. run
npx vitest run --config tests/integration/vitest.config.ts
```

When env vars are absent, the suite is skipped (CI-safe).

## CI

`.github/workflows/ci.yml` boots supabase via `supabase/setup-cli` action and runs the suite.
