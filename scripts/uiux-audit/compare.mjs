// node scripts/uiux-audit/compare.mjs <before-label> <after-label>
// Prints totals and per-screen deltas for two web runs, and for mobile runs when present.
import fs from 'node:fs'
const [a, b] = process.argv.slice(2)
const read = (f) => (fs.existsSync(new URL(`./out/${f}`, import.meta.url)) ? JSON.parse(fs.readFileSync(new URL(`./out/${f}`, import.meta.url), 'utf8')) : null)
const axe = (r, id) => (r.axe ?? []).filter((v) => !id || v.id === id).reduce((n, v) => n + v.n, 0)
const web = [read(`web-${a}.json`), read(`web-${b}.json`)]
if (web[0] && web[1]) {
  const sum = (rows, f) => rows.filter((r) => !r.error).reduce((n, r) => n + f(r), 0)
  for (const [name, f] of [['contrast', (r) => axe(r, 'color-contrast')], ['axe total', (r) => axe(r)], ['targets <44px', (r) => r.under44], ['targets <24px', (r) => r.under24], ['text <12px', (r) => r.fontUnder12]]) {
    console.log(`web ${name.padEnd(14)} ${String(sum(web[0], f)).padStart(5)} → ${sum(web[1], f)}`)
  }
}
for (const p of ['ios', 'android']) {
  const m = [read(`mobile-${p}-${a}.json`), read(`mobile-${p}-${b}.json`)]
  if (!m[0] || !m[1]) continue
  const taps = (rows) => rows.filter((r) => r.screen !== 'brain-play').reduce((n, r) => n + r.tapsFromHome, 0)
  const under = (rows) => rows.reduce((n, r) => n + r.under, 0)
  console.log(`${p} taps to destinations ${taps(m[0])} → ${taps(m[1])} · small targets ${under(m[0])} → ${under(m[1])}`)
}
