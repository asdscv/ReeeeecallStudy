// Preserve the established command; all brand exports now share one vector source.
import { generateBrandAssets } from './generate-brand-assets'

generateBrandAssets().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
