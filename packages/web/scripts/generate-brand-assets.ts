import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

// One vector source supplies web UI, mobile UI, launchers, splash and store icons.
const root = resolve(import.meta.dirname, '../../..')
const publicDir = resolve(root, 'packages/web/public')
const mobileDir = resolve(root, 'packages/mobile/assets')
const sourceDir = resolve(root, 'packages/shared/brand')
const ink = '#0f172a' // Matches the existing native splash and LoadingScreen.

export async function generateBrandAssets() {
  const symbol = await readFile(resolve(sourceDir, 'reklue-symbol.svg'))
  const micro = await readFile(resolve(sourceDir, 'reklue-micro.svg'))
  const white = await readFile(resolve(sourceDir, 'reklue-symbol-white.svg'))
  const wordmark = await readFile(resolve(sourceDir, 'reklue-wordmark.svg'))
  const icon = await sharp(symbol).resize(512, 512).png().toBuffer()
  const type = await sharp(wordmark, { density: 300 }).resize(840).png().toBuffer()
  await Promise.all([
    writeFile(resolve(publicDir, 'favicon.png'), icon),
    writeFile(resolve(mobileDir, 'favicon.png'), icon),
    writeFile(resolve(mobileDir, 'logo-icon.png'), icon),
    writeFile(resolve(publicDir, 'logo-text.svg'), wordmark),
    writeFile(resolve(publicDir, 'logo-text.png'), type),
    writeFile(resolve(mobileDir, 'logo-text.png'), type),
  ])

  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><radialGradient id="bg" cx=".5" cy=".25" r=".9"><stop stop-color="#1a315b"/><stop offset="1" stop-color="${ink}"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#bg)"/></svg>`)
  const launcher = await sharp(background).composite([
    { input: await sharp(symbol).resize(900, 900).png().toBuffer(), left: 62, top: 62 },
  ]).removeAlpha().png().toBuffer()
  await writeFile(resolve(mobileDir, 'icon.png'), launcher)
  await writeFile(resolve(mobileDir, 'android-icon-background.png'), await sharp(background).removeAlpha().png().toBuffer())

  // Android adaptive masks reserve a central safe zone. Transparent padding is
  // intentional: do not enlarge the card stack to fill the foreground canvas.
  for (const [file, input] of [
    ['android-icon-foreground.png', symbol],
    ['android-icon-monochrome.png', white],
  ] as const) {
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } })
      .composite([{ input: await sharp(input).resize(680, 680).png().toBuffer(), left: 172, top: 172 }])
      .png().toFile(resolve(mobileDir, file))
  }
  // Retain the padded splash layout that prevents Android launch-logo cropping.
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } })
    .composite([{ input: icon, left: 256, top: 256 }]).png().toFile(resolve(mobileDir, 'splash-icon-padded.png'))

  await mkdir(resolve(publicDir, 'brand'), { recursive: true })
  for (const size of [192, 512, 1024]) {
    await sharp(launcher).resize(size).png().toFile(resolve(publicDir, `brand/app-icon-${size}.png`))
  }
  await sharp(launcher).resize(180).png().toFile(resolve(publicDir, 'brand/apple-touch-icon.png'))
  await sharp(micro).resize(32).png().toFile(resolve(publicDir, 'brand/favicon-32.png'))
  await sharp(launcher).resize(512).png().toFile(resolve(root, 'packages/mobile/store-assets/app-icon-512.png'))
  await writeFile(resolve(root, 'packages/mobile/store-assets/app-icon-1024.png'), launcher)

  const logo = await sharp(type).resize(650).png().toBuffer()
  const logoHeight = (await sharp(logo).metadata()).height!
  const combined = await sharp({ create: { width: 920, height: 240, channels: 4, background: '#00000000' } })
    .composite([
      { input: await sharp(symbol).resize(220).png().toBuffer(), left: 0, top: 10 },
      { input: logo, left: 250, top: Math.round((240 - logoHeight) / 2) },
    ]).png().toBuffer()
  await writeFile(resolve(publicDir, 'reklue-logo.png'), combined)
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#ffffff' } })
    .composite([{ input: combined, left: 140, top: 195 }]).png().toFile(resolve(publicDir, 'og-image.png'))
  console.log('Generated web, mobile, launcher, padded splash, PWA and store brand assets.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateBrandAssets().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
}
