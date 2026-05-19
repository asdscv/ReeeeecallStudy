// Render sample card field_values into crawler-visible HTML + structured data.
// Both word-style decks (front/back/example_front/example_back) and phrase-style
// decks (front/back/alt/situation/note) are handled.
import { escapeHtml } from './helpers.js'
import { SITE_URL } from './constants.js'

const FIELD_ORDER_WORD = ['front', 'back', 'example_front', 'example_back']
const FIELD_ORDER_PHRASE = ['front', 'back', 'alt', 'situation', 'note']

function labelFor(key, lang) {
  const labels = {
    en: {
      front: 'Front',
      back: 'Back',
      example_front: 'Example',
      example_back: 'Translation',
      alt: 'Alternative',
      situation: 'Situation',
      note: 'Note',
    },
    ko: {
      front: '앞면',
      back: '뜻',
      example_front: '예문',
      example_back: '예문 번역',
      alt: '대체 표현',
      situation: '상황',
      note: '메모',
    },
  }
  const dict = labels[lang] || labels.en
  return dict[key] || key
}

function detectKind(values) {
  if (values && typeof values.kind === 'string') return values.kind
  // Heuristic fallback when `kind` is absent
  if (values && (values.situation || values.alt || values.note)) return 'phrase'
  return 'word'
}

function orderedEntries(values) {
  if (!values || typeof values !== 'object') return []
  const kind = detectKind(values)
  const preferred = kind === 'phrase' ? FIELD_ORDER_PHRASE : FIELD_ORDER_WORD
  const seen = new Set()
  const out = []
  for (const key of preferred) {
    if (typeof values[key] === 'string' && values[key].length > 0) {
      out.push([key, values[key]])
      seen.add(key)
    }
  }
  // Append any extra string fields we didn't anticipate
  for (const [k, v] of Object.entries(values)) {
    if (k === 'kind' || seen.has(k) || typeof v !== 'string' || v.length === 0) continue
    out.push([k, v])
  }
  return out
}

/**
 * Render up to N sample cards as semantic HTML.
 *
 * @param {Array<{field_values: Record<string,string>}>} sampleFields
 * @param {string} lang
 * @param {string} listingTitle (used for accessibility labels only)
 * @returns {string} HTML fragment (empty when there are no samples)
 */
export function renderSampleCardsHtml(sampleFields, lang, listingTitle) {
  if (!Array.isArray(sampleFields) || sampleFields.length === 0) return ''

  const heading = lang === 'ko' ? '카드 미리보기' : 'Card preview'
  const caption = lang === 'ko'
    ? '아래는 이 덱의 일부 카드 예시입니다.'
    : 'A few sample cards from this deck.'

  const items = sampleFields.map((card, idx) => {
    const entries = orderedEntries(card?.field_values)
    if (entries.length === 0) return ''
    const dl = entries.map(([key, value]) => {
      const label = labelFor(key, lang)
      const tag = key === 'front' ? 'strong' : (key.startsWith('example') ? 'blockquote' : 'span')
      return `<dt>${escapeHtml(label)}</dt><dd><${tag}>${escapeHtml(value)}</${tag}></dd>`
    }).join('')
    const aria = escapeHtml(`${listingTitle || ''} — sample ${idx + 1}`).trim()
    return `<article class="card-sample" itemscope itemtype="https://schema.org/LearningResource" aria-label="${aria}">
  <dl>${dl}</dl>
</article>`
  }).filter(Boolean).join('\n')

  if (items.length === 0) return ''

  return `<section aria-label="${escapeHtml(heading)}">
  <h2>${escapeHtml(heading)}</h2>
  <p>${escapeHtml(caption)}</p>
  ${items}
</section>`
}

/**
 * Build schema.org Dataset `hasPart` LearningResource entries for sample cards.
 *
 * @param {Array<{field_values: Record<string,string>}>} sampleFields
 * @param {string} listingId
 * @param {string} lang
 * @returns {Array<Object>} JSON-LD LearningResource items
 */
export function buildSampleCardLearningResources(sampleFields, listingId, lang) {
  if (!Array.isArray(sampleFields)) return []
  const out = []
  for (let i = 0; i < sampleFields.length; i++) {
    const values = sampleFields[i]?.field_values
    if (!values || typeof values !== 'object') continue
    const front = typeof values.front === 'string' ? values.front : ''
    const back = typeof values.back === 'string' ? values.back : ''
    if (!front && !back) continue
    const exampleFront = typeof values.example_front === 'string' ? values.example_front : ''
    const exampleBack = typeof values.example_back === 'string' ? values.example_back : ''
    const teaches = [back, exampleFront, exampleBack].filter(Boolean).join(' — ')
    out.push({
      '@type': 'LearningResource',
      '@id': `${SITE_URL}/d/${listingId}#card-${i + 1}`,
      name: front || back,
      teaches: teaches || back || front,
      learningResourceType: 'Flashcard',
      inLanguage: lang,
      isAccessibleForFree: true,
    })
  }
  return out
}
