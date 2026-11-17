# Reklue store graphics

The 1024×500 feature graphics use the stacked-card R symbol and outlined Reklue wordmark. Their SVG sources and PNG exports are generated together:

```sh
pnpm --filter @reklue/web exec tsx scripts/generate-store-graphics.ts
```

| Image | Google Play locales |
|---|---|
| `en` | en-US |
| `ko` | ko-KR |
| `ja` | ja-JP |
| `zh` | zh-CN |
| `vi` | vi |
| `th` | th |
| `id` | id |
| `es` | es-ES, es-419, es-US |

Store text is maintained in `DOCS/MOBILE/STORE_METADATA.md`. Store console drafts and review/publication status must be verified separately from committing these files.

App icons: `app-icon-512.png` (Play listing) and `app-icon-1024.png` (opaque iOS master).
Regenerate all launcher, splash and in-app brand assets with:

```sh
pnpm --filter @reklue/web exec tsx scripts/generate-brand-assets.ts
```

Sources: `packages/shared/brand/`. The Android foreground and monochrome layers
retain safe-zone padding; the splash retains its existing crop-protection padding.
