# Reklue store graphics

The 1024×500 feature graphics use the existing brain symbol and outlined Reklue wordmark. Their SVG sources and PNG exports are generated together:

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
