#!/usr/bin/env bash
# Bring the local Supabase stack up and apply every migration, retrying ONLY when
# the failure is the hosted-infrastructure flake.
#
# WHY THIS EXISTS. `supabase start` / `supabase db reset` pull and start containers
# through an upstream service that intermittently 5xxs. On 2026-08-01 it failed six
# times in one afternoon, always with the identical line:
#
#   Error status 502: An invalid response was received from the upstream server
#
# every time AFTER the migrations had applied cleanly ("Applying migration 180…",
# "Restarting containers…", then the 502). Each one needed a human to press
# re-run, and one of them landed on a release PR. It is noise, and noise that
# trains people to re-run a red check without reading it is worse than the flake.
#
# WHAT THIS DELIBERATELY DOES NOT DO. It does not retry a failed test, and it does
# not retry a failed migration. `db reset` applies the migrations, so a blanket
# retry would re-run a genuinely broken migration two more times and report it
# three times slower — and, worse, would make "it passed on attempt 3" a thing
# that can happen to real code. The retry is gated on the infrastructure signature
# and nothing else: any other failure exits immediately, with its own exit code.
#
# The retry is also LOUD. A ::warning:: on every attempt means a green check that
# needed two tries still says so in the log, instead of quietly looking clean.
#
# MODES. `up` (default) starts the stack and applies the migrations. `reset-only`
# re-applies them against a stack that is already running — the idempotency check,
# which exists to prove that resetting twice works. That step was NOT wrapped when
# this script was written, and on 2026-08-02 it took a CI run down on its own.
set -uo pipefail

MODE="${1:-up}"
ATTEMPTS="${SUPABASE_UP_ATTEMPTS:-3}"

# Matched against the CLI's own output. Kept narrow on purpose — this is the exact
# class observed, and widening it is how a retry starts swallowing real errors.
# 5xx is the upstream failing to serve; the second alternative is the CLI's wording
# for the same thing, matched separately in case the numeric prefix ever changes.
#
# The third alternative is a DIFFERENT failure from the same family, seen on
# 2026-08-02 during the second `db reset`:
#
#   failed to execute http request: Get "http://127.0.0.1:54321/storage/v1/bucket":
#   context deadline exceeded (Client.Timeout exceeded while awaiting headers)
#
# Not an upstream 5xx — the CLI could not reach a container of the LOCAL stack
# before its own timeout. Still infrastructure and never code: no migration can
# make an HTTP client time out talking to the storage API. Matched as the pair
# (failed request + deadline) rather than on "context deadline exceeded" alone,
# which is generic enough to appear in a real failure.
INFRA_RE='Error status 5[0-9][0-9]:|invalid response was received from the upstream server|failed to execute http request:.*context deadline exceeded'

log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

for attempt in $(seq 1 "$ATTEMPTS"); do
  # tee so the log still STREAMS to the runner — a several-minute step that prints
  # nothing until it finishes is its own kind of unhelpful.
  if [ "$MODE" = "reset-only" ]; then
    supabase db reset --no-seed 2>&1 | tee "$log_file"
  else
    { supabase start && supabase db reset --no-seed; } 2>&1 | tee "$log_file"
  fi
  code="${PIPESTATUS[0]}"

  if [ "$code" -eq 0 ]; then
    if [ "$attempt" -gt 1 ]; then
      echo "::warning::Supabase stack came up on attempt ${attempt}/${ATTEMPTS} after an upstream 5xx. The code was never the problem, but this run is not evidence of a clean first try."
    fi
    exit 0
  fi

  if ! grep -qE "$INFRA_RE" "$log_file"; then
    echo "::error::Supabase bring-up failed for a reason that is NOT the known upstream 5xx — not retrying, because this is the shape a broken migration has."
    exit "$code"
  fi

  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    echo "::warning::Upstream 5xx on attempt ${attempt}/${ATTEMPTS}. Tearing the stack down and retrying — a half-started stack is why a bare retry does not work."
    # Without this the next `supabase start` inherits containers from the attempt
    # that just died, which fails differently and hides the original cause.
    supabase stop >/dev/null 2>&1 || true
    sleep "$((attempt * 10))"
    # reset-only was handed a RUNNING stack, and the teardown above just took it
    # away — so it has to be put back before the next reset. Bringing it up fully
    # is also the only thing that fixes the failure this mode actually sees: a
    # storage container that never became reachable.
    if [ "$MODE" = "reset-only" ]; then
      supabase start >/dev/null 2>&1 || true
    fi
  fi
done

echo "::error::Supabase stack did not come up in ${ATTEMPTS} attempts, every one an upstream 5xx. That is no longer a flake — check the Supabase status page before assuming it is this repository."
exit 1
