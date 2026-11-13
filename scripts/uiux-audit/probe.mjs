// UI/UX probe, imported into a page of the LOCAL dev server through Vite's /@fs/ route.
// Measures touch-target sizes, small text, horizontal overflow and runs axe (WCAG 2.2 AA).
const AXE = new URL('./vendor/axe.min.js', import.meta.url).href

function vis(el) {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0
}
function label(el) {
  return (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.tagName)
    .trim().replace(/\s+/g, ' ').slice(0, 28)
}
async function loadAxe() {
  if (window.axe) return
  await new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = AXE
    s.onload = res
    s.onerror = rej
    document.head.appendChild(s)
  })
}

export async function run() {
  await loadAxe()
  const inter = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab]')].filter(vis)
  const under44 = []
  const under24 = []
  for (const el of inter) {
    const r = el.getBoundingClientRect()
    const s = `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`
    if (r.width < 44 || r.height < 44) under44.push(s)
    if (r.width < 24 || r.height < 24) under24.push(s)
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  let texts = 0, lt12 = 0, lt14 = 0
  const tiny = []
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || seen.has(el) || !vis(el)) continue
    seen.add(el)
    texts++
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 12) { lt12++; if (tiny.length < 6) tiny.push(`${fs}px "${n.textContent.trim().slice(0, 20)}"`) }
    if (fs < 14) lt14++
  }
  const header = document.querySelector('header')
  const navItems = header
    ? [...header.querySelectorAll('nav a, nav button')].filter(vis).map((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return `${label(el)}|${Math.round(r.width)}x${Math.round(r.height)}|${cs.flexDirection}|${cs.fontSize}`
      })
    : []
  const ax = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    resultTypes: ['violations'],
  })
  return {
    path: location.pathname,
    vw: innerWidth,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    pageHeight: document.documentElement.scrollHeight,
    interactive: inter.length,
    under44: under44.length,
    under24: under24.length,
    under24Samples: under24.slice(0, 6),
    under44Samples: under44.slice(0, 6),
    texts,
    fontUnder12: lt12,
    fontUnder14: lt14,
    tiny,
    headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
    navItems,
    axe: ax.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 2).map((x) => x.target.join(' ').slice(0, 50)) })),
  }
}
