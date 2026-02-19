import sharp from 'sharp'
import { resolve } from 'path'

const WIDTH = 1200
const HEIGHT = 630

async function main() {
  const logoPath = resolve(import.meta.dirname, '..', 'public', 'reeeeecallstudy_symbol_logo-removebg-preview.png')
  const outPath = resolve(import.meta.dirname, '..', 'public', 'og-image.png')

  // Scale logo to fill ~90% of width, maintaining aspect ratio
  const targetLogoWidth = Math.round(WIDTH * 0.90)
  const logo = await sharp(logoPath)
    .resize(targetLogoWidth, null, { fit: 'inside' })
    .toBuffer()

  const logoMeta = await sharp(logo).metadata()
  const logoW = logoMeta.width!
  const logoH = logoMeta.height!

  // Center the logo
  const left = Math.round((WIDTH - logoW) / 2)
  const top = Math.round((HEIGHT - logoH) / 2)

  // Create white background with logo centered
  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logo, left, top }])
    .png()
    .toFile(outPath)

  console.log(`OG image generated: ${outPath} (${WIDTH}x${HEIGHT})`)
  console.log(`Logo: ${logoW}x${logoH}, positioned at (${left}, ${top})`)
}

main()
