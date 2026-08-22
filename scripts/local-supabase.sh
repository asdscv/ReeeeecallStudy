#!/usr/bin/env bash
# Drive the local Supabase stack so it is never left running.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# `supabase start` creates its containers with `restart: unless-stopped`. That
# policy is not a preference, it is a promise: once the stack has been started
# even once, every subsequent start of the Docker engine — for ANY reason, on any
# project, or from the socket-activation daemon reacting to a stray `docker ps` —
# brings the whole stack back up. On 2026-08-21 that had eleven containers of this
# project resident for 40 hours straight with nobody using them.
#
# Nothing in day-to-day development needs them. Every .env in this repo points at
# the hosted project, so `pnpm dev`, `pnpm build`, `pnpm test` and the mobile app
# never touch Docker. The stack is needed for exactly three things — a local
# migration chain check, the integration suite, and the *.sh e2e scripts in
# supabase/tests — and all three are finite tasks that should end with the stack
# gone.
#
# So: `with` runs a command between an up and a guaranteed down, and `up` defuses
# the restart policy for the case where a human takes the manual route and then
# closes the laptop. `down` is here so nobody has to remember which of `stop`,
# `down` or `halt` the CLI uses.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#
#   scripts/local-supabase.sh with <cmd...>   # up + migrations, run, ALWAYS down
#   scripts/local-supabase.sh up              # leave it up, but not resurrectable
#   scripts/local-supabase.sh down            # stop it
#
# Under `with`, the command is handed the same three variables CI's "Capture
# Supabase keys" step exports, so a suite reads identically here and on a runner:
# SUPABASE_LOCAL_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
set -uo pipefail

cd "$(dirname "$0")/.."

# `supabase` and `node` are not on a non-login shell's PATH on this machine.
export PATH="/opt/homebrew/opt/node/bin:/opt/homebrew/bin:$PATH"

command -v supabase >/dev/null || { echo "FATAL: supabase CLI not on PATH" >&2; exit 127; }

# The restart policy is set by the CLI at create time and there is no config knob
# for it, so it is rewritten after the fact. This is the belt to `with`'s braces:
# the trap handles the normal exit and the Ctrl-C, this handles the SIGKILL, the
# panic button and the closed laptop.
defuse_restart_policy() {
  local names
  names="$(docker ps -q --filter 'name=_reeeeecall-study' 2>/dev/null)"
  [ -n "$names" ] || return 0
  # shellcheck disable=SC2086
  docker update --restart=no $names >/dev/null 2>&1 || true
}

stack_up() {
  # The same wrapper CI uses: it starts the stack, applies every migration, and
  # retries ONLY the known upstream 5xx. Sharing it means a local check and a CI
  # check cannot drift on what "the stack is up" means.
  bash .github/scripts/supabase-up.sh "${1:-up}" || return $?
  defuse_restart_policy
}

stack_down() { supabase stop >/dev/null 2>&1 || true; }

case "${1:-}" in
  up)
    shift
    stack_up || exit $?
    echo "Local stack is up (restart policy defused). Take it down with: pnpm db:down"
    ;;

  down)
    stack_down
    echo "Local stack is down."
    ;;

  with)
    shift
    [ "$#" -gt 0 ] || { echo "usage: local-supabase.sh with <cmd...>" >&2; exit 2; }

    # Registered BEFORE the bring-up on purpose: a start that dies halfway leaves
    # containers behind, and those are the ones that get inherited by the next
    # start and fail differently. See the same reasoning in supabase-up.sh.
    trap stack_down EXIT INT TERM

    stack_up || exit $?

    ST="$(supabase status -o json 2>/dev/null)"
    SUPABASE_LOCAL_URL="http://127.0.0.1:54321"
    SUPABASE_ANON_KEY="$(echo "$ST" | jq -r .ANON_KEY)"
    SUPABASE_SERVICE_ROLE_KEY="$(echo "$ST" | jq -r .SERVICE_ROLE_KEY)"
    export SUPABASE_LOCAL_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
    [ -n "$SUPABASE_ANON_KEY" ] && [ "$SUPABASE_ANON_KEY" != "null" ] || {
      echo "FATAL: could not read keys from \`supabase status\`" >&2; exit 1; }

    "$@"
    exit $?
    ;;

  *)
    sed -n '/^# ── Usage/,/^# SUPABASE_LOCAL_URL/p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
