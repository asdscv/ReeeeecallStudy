# Mobile: force-update gate + study-card text-wrap completion

Branch: `worktree-mobile-force-update-textwrap` (based on `origin/develop`)
Status: **SHIPPED** — domain tests + 8-locale i18n parity + `tsc` clean.

---

## 1. Study-card text overflow → wrap (completes #146)

PRs #146/#147 fixed the **TTS** fields (icon + `flexShrink` text row) and added an
`overflow:'hidden'` safety net, but left `fieldBlock: alignItems:'center'`. The
**non-TTS** explanation text is a bare `<Text>` with no width; under a `center`
cross-axis parent iOS sizes it to its intrinsic single-line width and overflows
instead of wrapping — the gray "do me a solid는…" line still clipped/scrolled.

**Fix** (`StudySessionScreen.tsx`): `fieldBlock` `alignItems:'center'→'stretch'`
(definite width → wrap; centering preserved by `textStyle.textAlign`) +
`showsHorizontalScrollIndicator={false}` on the back-face ScrollView. TTS rows
unaffected (they already wrap via flexShrink and keep their own width:100%).

## 2. Force-update gate (new)

Backend-driven hard block + dismissable soft nudge. Layered (DIP):
`services/app-update/` pure `version.ts`+`gate.ts` (**fail-open**) ← infra
(`remote-config` Supabase RPC w/ 4s timeout, `current-version`, `store-url`) ←
`useAppUpdateStore` ← UI `components/update/{ForceUpdateScreen,OptionalUpdateModal}`.

Decision: `installed < min_supported_version → blocked` · `< latest_version →
optional` · else `ok`. Missing/garbage/error/timeout → `ok` (never bricks).

Wiring (`RootNavigator`): `check()` on mount; `blocked` → ForceUpdateScreen
before splash/auth/session; `optional` → overlay on the main stack.

Backend: `supabase/migrations/096_app_version_requirement.sql` — table
`app_version_requirements` + anon-callable SECURITY DEFINER RPC
`get_app_version_requirement`. Seeded `min='0.0.0'` (dormant). i18n: new `update`
namespace across all 8 locales. Store IDs: iOS `6761741123`, Android
`com.reeeeecall.study`. Current app version `1.0.2`.

### Activation (post-deploy)
Migration + client ship dormant. To force users off an old build, **after** a
newer build is live in the stores:
```sql
UPDATE app_version_requirements
  SET min_supported_version='1.0.3', latest_version='1.0.3', updated_at=NOW()
  WHERE platform IN ('ios','android');
```

### Verification
app-update 29/29 · i18n 307/307 · card-text-style 19/19 · cold-start-ota 13/13 ·
`tsc --noEmit` 0 errors. On-device visual confirm pending a build.
