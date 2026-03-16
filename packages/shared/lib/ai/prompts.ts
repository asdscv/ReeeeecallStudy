import type { GeneratedTemplateField } from './types'

const TTS_LANGUAGES = [
  'ko-KR', 'en-US', 'en-GB', 'ja-JP', 'zh-CN', 'zh-TW',
  'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'vi-VN', 'th-TH', 'id-ID',
]

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48]

const DECK_COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
]

export interface FieldHint {
  name: string
  side: 'front' | 'back'
  ttsLang?: string
}

export function buildTemplatePrompt(
  topic: string,
  uiLang: string,
  useCustomHtml: boolean,
  contentLang?: string,
  fieldHints?: FieldHint[],
) {
  const langInstruction = uiLang.startsWith('ko')
    ? '필드 이름은 한국어로 작성하세요.'
    : 'Write field names in English.'

  const htmlInstruction = useCustomHtml
    ? `Set layout_mode to "custom" and generate front_html and back_html.
Use {{fieldName}} placeholders (where fieldName is the field's "name" value).
Include clean inline CSS styles. Example:
<div style="text-align:center"><h1 style="font-size:2em">{{日本語}}</h1><p style="color:#666">{{読み方}}</p></div>`
    : 'Set layout_mode to "default" and leave front_html and back_html as empty strings.'

  // Build field specification from user hints
  let fieldSpec = ''
  if (fieldHints && fieldHints.length > 0) {
    const frontFields = fieldHints.filter((f) => f.side === 'front').map((f) => f.name)
    const backFields = fieldHints.filter((f) => f.side === 'back').map((f) => f.name)
    fieldSpec = `
The user wants these specific fields:
- Front side fields: ${frontFields.join(', ') || 'decide automatically'}
- Back side fields: ${backFields.join(', ') || 'decide automatically'}
Use these exact field names (as the "name" value). Generate field keys as "field_" + snake_case version of the name.`
  }

  // Content language instruction
  let contentLangInstruction = ''
  if (contentLang) {
    contentLangInstruction = `\n- The learning content language is ${contentLang}. Set tts_lang to "${contentLang}" for the primary content field(s) and enable tts_enabled for them.`
  }

  const systemPrompt = `You are a flashcard template designer. Generate a card template for the given topic.
Respond with a single JSON object (no markdown, no explanation).

JSON schema:
{
  "name": "template name",
  "fields": [
    { "key": "field_xxx", "name": "Display Name", "type": "text", "order": 0, "tts_enabled": true, "tts_lang": "en-US" }
  ],
  "front_layout": [
    { "field_key": "field_xxx", "style": "primary", "font_size": 40 }
  ],
  "back_layout": [
    { "field_key": "field_yyy", "style": "primary", "font_size": 32 }
  ],
  "layout_mode": "default",
  "front_html": "",
  "back_html": ""
}

Rules:
- field type must be "text" only
- field key format: "field_" + snake_case (e.g., "field_front", "field_reading")
- style: one of "primary", "secondary", "hint", "detail"
- font_size: one of ${JSON.stringify(FONT_SIZES)} (primary=40, secondary=24, hint/detail=16)
- tts_lang: one of ${JSON.stringify(TTS_LANGUAGES)} — choose appropriate for the topic's language
- Generate 2-6 fields, put front fields in front_layout, back fields in back_layout
- Each field must appear in exactly one layout (front or back)
- ${langInstruction}
- ${htmlInstruction}${fieldSpec}${contentLangInstruction}`

  const userPrompt = `Topic: ${topic}`

  return { systemPrompt, userPrompt }
}

export function buildDeckPrompt(topic: string, uiLang: string) {
  const langInstruction = uiLang.startsWith('ko')
    ? '덱 이름과 설명은 한국어로 작성하세요.'
    : 'Write deck name and description in English.'

  const systemPrompt = `You are a flashcard deck creator. Generate a deck metadata for the given topic.
Respond with a single JSON object.

JSON schema:
{
  "name": "deck name",
  "description": "brief description",
  "color": "#hex",
  "icon": "emoji"
}

Rules:
- color: one of ${JSON.stringify(DECK_COLORS)}
- icon: a single emoji that represents the topic
- ${langInstruction}`

  const userPrompt = `Topic: ${topic}`

  return { systemPrompt, userPrompt }
}

export function buildCardsPrompt(
  topic: string,
  fields: GeneratedTemplateField[],
  cardCount: number,
  existingCards?: Record<string, string>[],
) {
  const fieldDesc = fields
    .map((f) => `"${f.key}" (${f.name}${f.tts_lang ? `, lang: ${f.tts_lang}` : ''})`)
    .join(', ')

  const dupeInstruction = existingCards && existingCards.length > 0
    ? `\n\nEXISTING CARDS (do NOT generate duplicates of these):\n${JSON.stringify(existingCards.slice(0, 50))}`
    : ''

  const systemPrompt = `You are a flashcard content creator. Generate exactly ${cardCount} flashcards for the given topic.
Respond with a single JSON object.

JSON schema:
{
  "cards": [
    { "field_values": { "field_key": "value", ... }, "tags": ["tag1"] }
  ]
}

Rules:
- Each card's field_values must have these exact keys: ${fieldDesc}
- Fill values appropriate to each field's purpose and language
- tags: 1-3 short tags per card
- Generate exactly ${cardCount} cards
- Each card should be unique and educational${dupeInstruction}`

  const userPrompt = `Topic: ${topic}`

  return { systemPrompt, userPrompt }
}
