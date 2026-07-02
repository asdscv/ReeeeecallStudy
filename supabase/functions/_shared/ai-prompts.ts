// Shared prompt builders for the `ai-generate` edge function.
//
// SOLE runtime source of generation prompts: the client no longer builds
// prompts — it sends structured params and the server builds the prompt here.
// This blocks prompt-injection / using our key as a free general-purpose LLM.
//
// Kept behaviour-faithful to the legacy client builder
// (packages/shared/lib/ai/prompts.ts); a vitest sync-guard
// (packages/shared/lib/ai/__tests__/server-prompts-parity.test.ts) asserts they
// produce identical prompts. Pure TS, no Deno/npm APIs → importable by both Deno
// (edge runtime) and vitest.

export interface FieldHint {
  name: string
  side: 'front' | 'back'
  ttsLang?: string
}

export interface GeneratedTemplateField {
  key: string
  name: string
  type: 'text'
  order: number
  tts_enabled?: boolean
  tts_lang?: string
}

const TTS_LANGUAGES = [
  'ko-KR', 'en-US', 'en-GB', 'ja-JP', 'zh-CN', 'zh-TW',
  'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'vi-VN', 'th-TH', 'id-ID',
]

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48]

const DECK_COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
]

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

  // Chinese-specific template guidance
  let chineseTemplateInstruction = ''
  if (contentLang === 'zh-CN' || contentLang === 'zh-TW') {
    const charType = contentLang === 'zh-CN' ? 'Simplified Chinese (简体字)' : 'Traditional Chinese (繁體字)'
    chineseTemplateInstruction = `
- This is a Chinese language deck. You MUST include a dedicated field for Chinese characters (汉字/漢字) as the primary front field with large font_size (40-48).
- Use ${charType} for all Chinese character fields.
- Include a separate pinyin field (style: "secondary") — do NOT combine characters and pinyin in one field.
- The Chinese character field must use tts_lang "${contentLang}" with tts_enabled true.`
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
- ${htmlInstruction}${fieldSpec}${contentLangInstruction}${chineseTemplateInstruction}`

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

  // Detect Chinese language from field tts_lang
  const chineseLang = fields.find((f) => f.tts_lang === 'zh-CN' || f.tts_lang === 'zh-TW')?.tts_lang
  let chineseCardInstruction = ''
  if (chineseLang) {
    const charType = chineseLang === 'zh-CN'
      ? 'Simplified Chinese characters (简体字)'
      : 'Traditional Chinese characters (繁體字)'
    chineseCardInstruction = `
- CRITICAL: This is a Chinese language deck. Use ONLY ${charType} — do NOT mix simplified and traditional.
- Every card MUST have actual Chinese characters (汉字/漢字) in the character field. NEVER leave the character field empty.
- Pinyin must include proper tone marks (e.g., "shíyòng" not "shiyong").
- Do NOT generate cards with only pinyin and no characters.
- For single-character words like 的(de), 了(le), 是(shì): the character field MUST still contain the Chinese character, not just pinyin.`
  }

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
- Every field_values key must have a non-empty value — do NOT leave any field blank
- tags: 1-3 short tags per card
- Generate exactly ${cardCount} cards
- Each card should be unique and educational${chineseCardInstruction}${dupeInstruction}`

  const userPrompt = `Topic: ${topic}`

  return { systemPrompt, userPrompt }
}

// Vision: generate cards FROM an uploaded image (textbook page, vocab list,
// notes, slides). The image rides in the user message; this builds the
// instruction + schema. Mirrors buildCardsPrompt's schema/rules.
export function buildImageCardsPrompt(
  fields: GeneratedTemplateField[],
  cardCount: number,
  uiLang: string,
) {
  const fieldDesc = fields
    .map((f) => `"${f.key}" (${f.name}${f.tts_lang ? `, lang: ${f.tts_lang}` : ''})`)
    .join(', ')
  const langNote = uiLang.startsWith('ko')
    ? '내용은 이미지에 보이는 언어를 따르세요.'
    : 'Use the language shown in the image for the content.'

  const systemPrompt = `You are a flashcard content creator. You are given an IMAGE (a textbook page, vocabulary list, handwritten notes, or slides). Extract the study material that is ACTUALLY in the image and turn it into flashcards.
Respond with a single JSON object.

JSON schema:
{
  "cards": [
    { "field_values": { "field_key": "value", ... }, "tags": ["tag1"] }
  ]
}

Rules:
- Each card's field_values must have these exact keys: ${fieldDesc}
- Base every card ONLY on content visible in the image — do NOT invent unrelated material.
- Create ONE card per distinct study item ACTUALLY in the image (maximum ${cardCount}). Do NOT pad to a fixed number — if the image has 5 items make 5 cards, if it has 18 make 18. Let the image decide the count.
- Every field_values key must have a non-empty value.
- tags: 1-3 short tags per card
- ${langNote}`

  const userPrompt = 'Create flashcards from the attached image.'

  return { systemPrompt, userPrompt }
}

// Image → a COMPLETE new deck (metadata + template + cards) in one vision call.
// Used by kind='image_deck' (always paid). The model both recognizes the image and
// designs a fitting template, so no fields are supplied by the caller.
export function buildImageDeckPrompt(uiLang: string) {
  const langNote = uiLang.startsWith('ko')
    ? '덱 이름과 설명은 한국어로 작성하고, 카드 내용은 이미지에 보이는 언어를 따르세요.'
    : 'Write the deck name and description in English; use the language shown in the image for card content.'

  const systemPrompt = `You are a flashcard deck creator with vision. You are given an IMAGE (a textbook page, vocabulary list, handwritten notes, or slides). Recognize the study material that is ACTUALLY in the image and turn it into a COMPLETE flashcard deck: deck metadata, a card template, and cards.
Respond with a single JSON object.

JSON schema:
{
  "name": "deck name that reflects the image content",
  "description": "brief description",
  "color": "#hex",
  "icon": "emoji",
  "template": {
    "name": "template name",
    "fields": [
      { "key": "front", "name": "Front", "type": "text" },
      { "key": "back", "name": "Back", "type": "text" }
    ]
  },
  "cards": [
    { "field_values": { "front": "value", "back": "value" }, "tags": ["tag"] }
  ]
}

Rules:
- Choose 2-3 template fields that fit the material (e.g. term/definition, word/meaning/example, question/answer). Each field "key" must be lowercase snake_case; every card's field_values keys MUST match the template field keys EXACTLY.
- Field "type" is always "text".
- Only include content that is ACTUALLY visible in the image — do not invent facts.
- Create one card per distinct item in the image, up to 30 cards.
- ${langNote}`

  const userPrompt = 'Recognize this image and create a complete flashcard deck (metadata + template + cards) from its content.'

  return { systemPrompt, userPrompt }
}
