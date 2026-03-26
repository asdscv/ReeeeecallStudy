import { escapeHtml } from './helpers.js'

export function renderBlocksToHtml(blocks, { articleTitle } = {}) {
  const parts = []
  for (const block of blocks) {
    if (!block.props) continue
    const p = block.props
    switch (block.type) {
      case 'heading':
        parts.push(`<h2>${escapeHtml(p.text)}</h2>`)
        break
      case 'paragraph':
        parts.push(`<p>${escapeHtml(p.text)}</p>`)
        break
      case 'blockquote':
        parts.push(`<blockquote><p>${escapeHtml(p.text)}</p>${p.attribution ? `<footer>— ${escapeHtml(p.attribution)}</footer>` : ''}</blockquote>`)
        break
      case 'statistics':
        if (p.items) {
          parts.push('<dl>' + p.items.map((it) => `<dt>${escapeHtml(it.label || '')}</dt><dd>${escapeHtml(it.value || '')}</dd>`).join('') + '</dl>')
        }
        break
      case 'feature_cards':
        if (p.items) {
          parts.push('<ul>' + p.items.map((it) => `<li><strong>${escapeHtml(it.title || '')}</strong>: ${escapeHtml(it.description || '')}</li>`).join('') + '</ul>')
        }
        break
      case 'numbered_list':
        if (p.items) {
          parts.push('<ol>' + p.items.map((it) => `<li><strong>${escapeHtml(it.heading || '')}</strong> ${escapeHtml(it.description || '')}</li>`).join('') + '</ol>')
        }
        break
      case 'highlight_box':
        parts.push(`<aside><h3>${escapeHtml(p.title || '')}</h3><p>${escapeHtml(p.description || '')}</p></aside>`)
        break
      case 'image': {
        const alt = p.alt || p.caption || articleTitle || ''
        parts.push(`<figure>${p.src ? `<img src="${escapeHtml(p.src)}" alt="${escapeHtml(alt)}" loading="lazy">` : ''}${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}</figure>`)
        break
      }
      case 'cta':
        parts.push(`<section><h3>${escapeHtml(p.title || '')}</h3><p>${escapeHtml(p.description || '')}</p>${p.buttonUrl ? `<a href="${escapeHtml(p.buttonUrl)}">${escapeHtml(p.buttonText || 'Learn More')}</a>` : ''}</section>`)
        break
      default:
        // hero block — extract title/subtitle
        if (p.title) parts.push(`<p><strong>${escapeHtml(p.title)}</strong></p>`)
        if (p.subtitle) parts.push(`<p>${escapeHtml(p.subtitle)}</p>`)
        if (p.description) parts.push(`<p>${escapeHtml(p.description)}</p>`)
        if (p.text) parts.push(`<p>${escapeHtml(p.text)}</p>`)
        break
    }
  }
  return parts.join('\n')
}

export function extractPlainTextFromBlocks(blocks) {
  const texts = []
  for (const block of blocks) {
    if (!block.props) continue
    const p = block.props
    if (p.text) texts.push(p.text)
    if (p.title) texts.push(p.title)
    if (p.subtitle) texts.push(p.subtitle)
    if (p.description) texts.push(p.description)
    if (p.items) {
      for (const item of p.items) {
        if (item.label) texts.push(item.label)
        if (item.value) texts.push(item.value)
        if (item.heading) texts.push(item.heading)
        if (item.description) texts.push(item.description)
        if (item.title) texts.push(item.title)
      }
    }
  }
  return texts.join(' ')
}
