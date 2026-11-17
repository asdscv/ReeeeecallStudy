import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const captions: Record<string, string> = {
  en: 'Flashcards & Brain Games',
  ko: '카드 공부와 두뇌 게임',
  ja: '暗記カードと脳トレ',
  zh: '闪卡学习与脑力游戏',
  vi: 'Thẻ học & trò chơi trí não',
  th: 'แฟลชการ์ดและเกมฝึกสมอง',
  id: 'Flashcard & permainan otak',
  es: 'Tarjetas de estudio y juegos mentales',
}

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function main() {
  const publicDir = resolve(import.meta.dirname, '..', 'public')
  const outDir = resolve(publicDir, '..', '..', 'mobile', 'store-assets', 'feature-graphics')
  const symbol = (await readFile(resolve(publicDir, 'favicon.png'))).toString('base64')
  const wordmark = Buffer.from((await readFile(resolve(publicDir, 'logo-text.svg'), 'utf8'))
    .replace('#10131a', '#f8faff')).toString('base64')
  await mkdir(outDir, { recursive: true })
  for (const [locale, caption] of Object.entries(captions)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="500" viewBox="0 0 1024 500">
<title>Reklue — ${xml(caption)}</title>
<defs><linearGradient id="canvas" x2="1" y2="1"><stop stop-color="#152c50"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
<rect width="1024" height="500" fill="url(#canvas)"/>
<path d="M64 418H960" stroke="#8ebdff" stroke-opacity=".2"/>
<image x="64" y="75" width="280" height="280" xlink:href="data:image/png;base64,${symbol}"/>
<image x="360" y="125" width="536" height="172" xlink:href="data:image/svg+xml;base64,${wordmark}"/>
<text x="512" y="365" text-anchor="middle" font-family="Arial,Apple SD Gothic Neo,Hiragino Sans GB,Thonburi,sans-serif" font-size="34" font-weight="500" fill="#c0d2ed">${xml(caption)}</text>
<text x="512" y="463" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" letter-spacing="1" fill="#83b8ff">reklue.com</text>
</svg>`
    await writeFile(resolve(outDir, `${locale}.svg`), svg)
    await sharp(Buffer.from(svg)).png().toFile(resolve(outDir, `${locale}.png`))
  }
  console.log(`Generated ${Object.keys(captions).length} Reklue feature graphics (1024×500).`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
