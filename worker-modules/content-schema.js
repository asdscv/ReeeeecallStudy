// Block schema validation for AI-generated content

import { PIPELINE_DEFAULTS } from './config.js'

const ALLOWED_ICONS = [
  'brain', 'book', 'clock', 'target', 'chart', 'star', 'lightning',
  'puzzle', 'globe', 'trophy', 'pencil', 'graduation', 'heart',
  'shield', 'rocket', 'light', 'check', 'users', 'calendar', 'flag',
]

const ALLOWED_COLORS = [
  'blue', 'green', 'purple', 'orange', 'red', 'teal', 'pink', 'yellow',
]

const HIGHLIGHT_VARIANTS = ['blue', 'green', 'amber']

const BRAND_SUFFIX = ' | ReeeeecallStudy'

// Strip markdown formatting (**bold**, *italic*) from plain text fields
function stripMarkdown(str) {
  if (typeof str !== 'string') return str
  return str.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
}

const blockValidators = {
  hero(props) {
    if (!props.title || typeof props.title !== 'string') return 'hero: title required'
    return null
  },

  paragraph(props) {
    if (!props.text || typeof props.text !== 'string') return 'paragraph: text required'
    return null
  },

  heading(props) {
    if (![2, 3].includes(props.level)) return 'heading: level must be 2 or 3'
    if (!props.text || typeof props.text !== 'string') return 'heading: text required'
    return null
  },

  feature_cards(props) {
    if (!Array.isArray(props.items) || props.items.length === 0) return 'feature_cards: items array required'
    for (const item of props.items) {
      if (!item.icon || !item.title || !item.description) {
        return 'feature_cards: each item needs icon, title, description'
      }
      item.title = stripMarkdown(item.title)
      item.description = stripMarkdown(item.description)
      if (!ALLOWED_ICONS.includes(item.icon)) {
        item.icon = 'star' // fallback
      }
      if (item.color && !ALLOWED_COLORS.includes(item.color)) {
        item.color = 'blue' // fallback
      }
    }
    return null
  },

  numbered_list(props) {
    if (!Array.isArray(props.items) || props.items.length === 0) return 'numbered_list: items array required'
    for (const item of props.items) {
      if (!item.heading || !item.description) {
        return 'numbered_list: each item needs heading and description'
      }
      item.heading = stripMarkdown(item.heading)
      item.description = stripMarkdown(item.description)
    }
    return null
  },

  highlight_box(props) {
    if (!props.title || typeof props.title !== 'string') return 'highlight_box: title required'
    if (!props.description || typeof props.description !== 'string') return 'highlight_box: description required'
    props.title = stripMarkdown(props.title)
    props.description = stripMarkdown(props.description)
    if (props.variant && !HIGHLIGHT_VARIANTS.includes(props.variant)) {
      props.variant = 'blue' // fallback
    }
    return null
  },

  divider() {
    return null
  },

  cta(props) {
    if (!props.title || typeof props.title !== 'string') return 'cta: title required'
    if (!props.description || typeof props.description !== 'string') return 'cta: description required'
    if (!props.buttonText || typeof props.buttonText !== 'string') return 'cta: buttonText required'
    props.buttonUrl = '/auth/login' // always enforce
    return null
  },
}

export function validateContentBlocks(blocks) {
  const errors = []

  if (!Array.isArray(blocks)) {
    return { valid: false, errors: ['content_blocks must be an array'] }
  }

  if (blocks.length < PIPELINE_DEFAULTS.minBlocks || blocks.length > PIPELINE_DEFAULTS.maxBlocks) {
    errors.push(`block count ${blocks.length} outside range ${PIPELINE_DEFAULTS.minBlocks}-${PIPELINE_DEFAULTS.maxBlocks}`)
  }

  if (blocks.length > 0 && blocks[0].type !== 'hero') {
    errors.push('first block must be hero')
  }

  if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'cta') {
    errors.push('last block must be cta')
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (!block.type || !block.props) {
      errors.push(`block[${i}]: type and props required`)
      continue
    }

    if (['image', 'blockquote', 'statistics'].includes(block.type)) {
      errors.push(`block[${i}]: ${block.type} type not allowed`)
      continue
    }

    const validator = blockValidators[block.type]
    if (!validator) {
      errors.push(`block[${i}]: unknown type "${block.type}"`)
      continue
    }

    const err = validator(block.props)
    if (err) errors.push(`block[${i}]: ${err}`)
  }

  return { valid: errors.length === 0, errors }
}

export function validateArticle(article) {
  const errors = []

  if (!article.title || typeof article.title !== 'string') errors.push('title required')
  if (!article.slug || typeof article.slug !== 'string') errors.push('slug required')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) errors.push('slug must be lowercase kebab-case')
  if (!article.meta_title || typeof article.meta_title !== 'string') errors.push('meta_title required')
  if (!article.meta_description || typeof article.meta_description !== 'string') errors.push('meta_description required')

  // Enforce brand suffix on meta_title
  if (article.meta_title && !article.meta_title.endsWith(BRAND_SUFFIX)) {
    article.meta_title = article.meta_title + BRAND_SUFFIX
  }
  // Truncate meta_title to 60 chars
  if (article.meta_title && article.meta_title.length > 60) {
    article.meta_title = article.meta_title.slice(0, 60 - BRAND_SUFFIX.length) + BRAND_SUFFIX
  }
  // Truncate meta_description to 155 chars
  if (article.meta_description && article.meta_description.length > 155) {
    article.meta_description = article.meta_description.slice(0, 152) + '...'
  }
  if (!Array.isArray(article.tags) || article.tags.length === 0) errors.push('tags array required')
  if (typeof article.reading_time_minutes !== 'number') errors.push('reading_time_minutes must be a number')

  const blockResult = validateContentBlocks(article.content_blocks)
  if (!blockResult.valid) errors.push(...blockResult.errors)

  return { valid: errors.length === 0, errors }
}
