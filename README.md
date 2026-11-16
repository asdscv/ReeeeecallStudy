# Reklue · 리클루

Flashcard learning and brain games for web, iOS, and Android. The app supports eight languages, spaced repetition, AI-assisted card creation, and deck sharing.

- Web: https://reeeeecallstudy.xyz
- `packages/web`: React + Vite web app
- `packages/mobile`: Expo / React Native app
- `packages/shared`: shared learning logic, state and brand configuration
- `worker-modules`: content pipeline and server-rendered SEO

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm dev:mobile
pnpm build
pnpm test:worker
```

The public brand is **Reklue** (Korean: **리클루**). The existing domain, app identifiers, deep-link scheme, package namespaces, and service account identifiers remain unchanged so existing installations and links continue to work.

See [deployment instructions](DOCS/DEPLOYMENT/README.md) and [store listing copy](DOCS/MOBILE/STORE_METADATA.md). Updating the device home-screen name requires a new native build; updating the store listing is a separate release step.
