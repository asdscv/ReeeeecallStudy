# UI/UX audit (local only)

Measures the web app and the iOS/Android apps against a **local** Supabase stack with a throwaway test
account, so every screen shows real data and nothing touches the hosted project.

1. `bash scripts/uiux-audit/setup-local.sh` — local stack, test account, sample decks/cards/sessions, axe → `local.env` (gitignored)
2. Web: `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<LOCAL_ANON_KEY> pnpm --filter @reeeeecall/web exec vite --port 5192`,
   then `node scripts/uiux-audit/web-audit.mjs <label>` — 16 screens × desktop/phone × light/dark: axe (WCAG 2.2 AA), targets <44/<24px, text <12/<14px, overflow, screenshots.
3. Apps: point `packages/mobile/.env` at `http://<LAN IP>:54321` + the local anon key (babel reads the file, not the shell), `npx expo start --dev-client --clear`,
   Appium on :4723, then `IOS_UDID=<udid> node scripts/uiux-audit/mobile-audit.mjs ios <label>` (or `android`) — taps from the dashboard to each destination, tappable elements under 44pt/48dp, screenshots.
4. `node scripts/uiux-audit/compare.mjs <before> <after>`
5. `bash scripts/local-supabase.sh down`

Baseline (2026-11-12, before the brain-training v2 / navigation change): web contrast violations 654, axe total 856;
iOS and Android: 29 taps to reach 9 destinations.
