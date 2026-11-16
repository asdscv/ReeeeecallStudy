import sharp from 'sharp'
import { resolve } from 'path'

// Regenerate the checked-in raster exports from the outlined SVG wordmark.
// Existing asset URLs remain valid, including links shared before the rename.
async function main() {
  const publicDir = resolve(import.meta.dirname, '..', 'public')
  const wordmarkPath = resolve(publicDir, 'logo-text.svg')
  const mobileDir = resolve(import.meta.dirname, '..', '..', 'mobile', 'assets')
  const wordmark = await sharp(wordmarkPath, { density: 300 }).resize(840).png().toBuffer()
  await sharp(wordmark).toFile(resolve(publicDir, 'logo-text.png'))
  await sharp(wordmark).toFile(resolve(mobileDir, 'logo-text.png'))

  const symbol = await sharp(resolve(publicDir, 'favicon.png'))
    .resize(220, 220, { fit: 'contain', background: '#00000000' }).png().toBuffer()
  const logo = await sharp(wordmark).resize(650).png().toBuffer()
  const logoHeight = (await sharp(logo).metadata()).height!
  const combined = await sharp({
    create: { width: 920, height: 240, channels: 4, background: '#00000000' },
  }).composite([
    { input: symbol, left: 0, top: 10 },
    { input: logo, left: 250, top: Math.round((240 - logoHeight) / 2) },
  ]).png().toBuffer()

  await sharp(combined).toFile(resolve(publicDir, 'reeeeecallstudy_symbol_logo-removebg-preview.png'))
  await sharp({
    create: { width: 1200, height: 630, channels: 4, background: '#ffffff' },
  }).composite([{ input: combined, left: 140, top: 195 }])
    .png().toFile(resolve(publicDir, 'og-image.png'))

  console.log('Generated Reklue wordmarks, combined logo, and 1200×630 OG image.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
