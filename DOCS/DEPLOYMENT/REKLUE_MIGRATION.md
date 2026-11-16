# Reklue migration — 2026-11-16

## Applied configuration

- Public brand: Reklue / 리클루. Repository: `asdscv/Reklue`. Workspace packages: `@reklue/*`.
- Canonical site: `https://reklue.com`. Cloudflare Worker: `reklue`; both `reklue.com/*` and `www.reklue.com/*` are routed to it.
- Registrar nameservers: `martin.ns.cloudflare.com`, `samara.ns.cloudflare.com`. Registrant contact verification completed in HostingKR; the domain detail page now reports normal status without the unverified-contact label.
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
- Apple 1.0.6 was submitted successfully after the owner authorized the social-media age-rating answer. Only `socialMedia=true` and `socialMediaAgeRestricted=false` changed in the declaration; all other existing age answers were verified unchanged. Submission `606b32d3-397f-4266-8637-4bd9c7affb5c`, submitted at `2026-11-16T10:27:33Z`, was read back with one version item and **WAITING_FOR_REVIEW** on both submission and version.
- Play privacy-policy URL changed to `https://reklue.com/privacy-policy` and included in the existing release review. Publishing Overview confirms 1.0.6 and the localized rebrand are in review; automatic pre-review checks also cover the privacy-policy change.
- Apple bundle registration display name is now **Reklue**; bundle identifier `com.reeeeecall.study` is unchanged. Google Cloud deployment project display name is now **Reklue**; project ID `reeeeecallstudy` and number `203245252470` are unchanged.

## Preserved technical identities

These are compatibility/history references, not product display names. Do not rename them as a text-only cleanup:

- Installed iOS/Android app ID: `com.reeeeecall.study` (store updates and purchase association).
- Existing deep-link scheme: `reeeeecall`; Expo slug: `reeeeecall-study`, project UUID `31c2c126-f26c-4b75-aa03-6255e68a6032`.
- Previously stored preference, consent, device/session keys and fixed system-account login identifiers.
- Applied SQL migration history and Google service-account/project IDs.
- Former-domain redirect rules and their regression fixtures.

## Outstanding console checks

- Search keyword automation still reads the former Search Console property until the user confirms restricted access for the existing keyword service account on the new property. A briefly added grant was immediately revoked; only the owner remains on the new property.
- Use the owner’s `asdscv@gmail.com` Google account for this app. Cloud Console access with that account was verified. The earlier request to sign in with a different existing Google account was an unsupported ownership assumption and has been withdrawn. Supabase Google login is enabled; the real app login uses client `212581278702-r7560o2uu0b9gubgnrlncmiini7bf6i6.apps.googleusercontent.com` and returns through the existing Supabase callback to `https://reklue.com/auth/callback`. The OAuth consent-brand configuration still needs to be located and verified in the owner’s account; a project-picker search miss does not establish a different owner. No OAuth credentials, callbacks, providers or permissions were changed.
- Chrome computer control recovered. Registrar verification and Play privacy-policy checks above are complete; store approvals are external pending states.

## Verification

- Initial rebrand: 4,330 web tests and 245 Worker tests passed; all CI checks passed before the develop/main merges.
- Additional compact/lowercase alias regression cases: 3 tests passed; installed-app schemes and slugs remain intact.
- HTTPS migration: 247 Worker tests passed, including canonical HTTP upgrade and localhost preservation. Production HTTP, www and former-domain requests return path/query-preserving 308 redirects; canonical privacy and terms pages return 200.
- iOS and Android Metro exports passed for 1.0.6. All 8 PNG graphics decoded at 1024×500; multilingual rendering checked visually. Lint: zero errors, 5 pre-existing warnings.
