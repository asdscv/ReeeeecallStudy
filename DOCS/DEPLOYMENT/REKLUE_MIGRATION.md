# Reklue migration — 2026-11-16

## Applied configuration

- Public brand: Reklue / 리클루. Repository: `asdscv/Reklue`. Workspace packages: `@reklue/*`.
- Canonical site: `https://reklue.com`. Cloudflare Worker: `reklue`; both `reklue.com/*` and `www.reklue.com/*` are routed to it.
- Registrar nameservers: `martin.ns.cloudflare.com`, `samara.ns.cloudflare.com`.
- Former domain: `reeeeecallstudy.xyz`, automatic renewal OFF; existing registration remains active until February 2027 for redirects. Paths and queries are preserved.
- Support: `admin@reklue.com`, Cloudflare Email Routing enabled to the existing verified owner mailbox.
- Supabase project display name: Reklue. Auth Site URL: `https://reklue.com`; allowed callback: `https://reklue.com/auth/callback`.
- Edge-function `ALLOWED_ORIGINS`: new site plus former site and the existing localhost development origin. No API keys were rotated.
- Google Search Console: `sc-domain:reklue.com` ownership verified by TXT; `https://reklue.com/sitemap.xml` submitted.
- Official publisher profile, organization label and auth display metadata changed to Reklue. The existing profile trigger synchronized all **649** official listing author labels to `Reklue Official`. Roles, ownership, card contents and purchases were not changed.

## Store release

- Google Play: 10 localized names/descriptions, 10 new feature graphics, support website and support email committed through Android Publisher API and read back successfully.
- App Store: editable **1.0.6** version created; 8 names, subtitles, descriptions, keywords, support/privacy/marketing URLs and release notes saved and read back successfully.
- Native release: **1.0.6**, retaining the existing app identities. Android build **55** was submitted successfully; Android Publisher readback shows production release 1.0.6 with version code 55. iOS build **63** was uploaded, processed as VALID and attached to the editable 1.0.6 version. Store approval/public availability must be checked separately.
- Source graphics: `packages/mobile/store-assets/feature-graphics/`; regenerate with `pnpm --filter @reklue/web exec tsx scripts/generate-store-graphics.ts`.
- All **114** existing store screenshots were downloaded at original size and checked with OCR. The old official publisher name appeared only in the 19 marketplace frames (10 Play locales, 8 iPhone locales and 1 iPad set). Those obsolete frames were removed from the editable listings, preserving the first **5** images and their order in every set. Apple live 1.0.5 screenshot IDs were checked to be separate and left untouched. No image editing or additional UI automation was required.
- Production OTA update **73e6a0e4-6024-43fb-90ba-57331927af95** (runtime 1.0.6, iOS and Android) includes the final dark-mode wordmark fix. Main merge: `7d40fbbc3b822a2a06e203ee847e9b2681056e19`.
- Apple review draft is prepared, but adding version 1.0.6 for review is blocked by the new required `socialMedia` age-rating answer. Existing `userGeneratedContent` is true. The owner has been asked to confirm the social-media classification because it can change the eligible age rating. No age-rating answer was guessed or changed.

## Preserved technical identities

These are compatibility/history references, not product display names. Do not rename them as a text-only cleanup:

- Installed iOS/Android app ID: `com.reeeeecall.study` (store updates and purchase association).
- Existing deep-link scheme: `reeeeecall`; Expo slug: `reeeeecall-study`, project UUID `31c2c126-f26c-4b75-aa03-6255e68a6032`.
- Previously stored preference, consent, device/session keys and fixed system-account login identifiers.
- Applied SQL migration history and Google service-account/project IDs.
- Former-domain redirect rules and their regression fixtures.

## Outstanding console checks

- Search keyword automation still reads the former Search Console property until the user confirms restricted access for the existing keyword service account on the new property. A briefly added grant was immediately revoked; only the owner remains on the new property.
- Registrar contact verification, Google OAuth consent branding, and the Play privacy-policy setting need final console verification. Computer Use was returning `cgWindowNotFound` for both Chrome and Finder; no security warnings or authentication protections were bypassed.

## Verification

- Initial rebrand: 4,330 web tests and 245 Worker tests passed; all CI checks passed before the develop/main merges.
- Additional compact/lowercase alias regression cases: 3 tests passed; installed-app schemes and slugs remain intact.
- HTTPS migration: 247 Worker tests passed, including canonical HTTP upgrade and localhost preservation. Production HTTP, www and former-domain requests return path/query-preserving 308 redirects; canonical privacy and terms pages return 200.
- iOS and Android Metro exports passed for 1.0.6. All 8 PNG graphics decoded at 1024×500; multilingual rendering checked visually. Lint: zero errors, 5 pre-existing warnings.
