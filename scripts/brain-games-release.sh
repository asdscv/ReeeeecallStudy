#!/usr/bin/env bash
# Reklue brain games: local verification, or an explicitly requested OTA.
# Web: merging the feature PR into develop triggers the existing Cloudflare deployment.
# Mobile: merging develop into main triggers deploy-mobile.yml; ota reruns that release.
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-check}" in
  check)
    pnpm --filter @reklue/web exec tsc -b --noEmit
    pnpm --filter @reklue/web test
    pnpm --filter @reklue/web lint
    pnpm --filter @reklue/mobile exec tsc --noEmit
    pnpm --filter @reklue/mobile exec tsx src/i18n/i18n.test.ts
    pnpm --filter @reklue/web exec tsc -p tsconfig.e2e.json
    pnpm exec tsx tools/check-arch.ts
    pnpm build
    ;;
  ota)
    gh workflow run deploy-mobile.yml --repo asdscv/Reklue --ref main -f mode=ota
    ;;
  *)
    printf 'Usage: bash scripts/brain-games-release.sh [check|ota]\n' >&2
    exit 2
    ;;
esac
