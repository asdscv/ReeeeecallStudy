// ─── AI Provider Types ──────────────────────────────────────────────────

export interface AIProviderConfig {
  id: string
  name: string
  baseUrl: string
  models: AIModel[]
}

export interface AIModel {
  id: string
  name: string
}

export interface AIConfig {
  providerId: string
  apiKey: string
  model: string
  baseUrl?: string
}

export interface AIRequestOptions {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}

export interface AIResponse {
  content: string
  usage?: { promptTokens: number; completionTokens: number }
}

// ─── Generated Data Types ───────────────────────────────────────────────

export interface GeneratedTemplateField {
  key: string
  name: string
  type: 'text'
  order: number
  tts_enabled?: boolean
  tts_lang?: string
}

export interface GeneratedLayoutItem {
  field_key: string
  style: 'primary' | 'secondary' | 'hint' | 'detail'
  font_size?: number
}

export interface GeneratedTemplate {
  name: string
  fields: GeneratedTemplateField[]
  front_layout: GeneratedLayoutItem[]
  back_layout: GeneratedLayoutItem[]
  layout_mode: 'default' | 'custom'
  front_html: string
  back_html: string
}

export interface GeneratedDeck {
  name: string
  description: string
  color: string
  icon: string
}

export interface GeneratedCard {
  field_values: Record<string, string>
  tags: string[]
}

// ─── Generate Mode ──────────────────────────────────────────────────────

export type GenerateMode = 'full' | 'cards_only'

export type GenerateStep =
  | 'config'
  | 'generating_template'
  | 'review_template'
  | 'generating_deck'
  | 'review_deck'
  | 'generating_cards'
  | 'review_cards'
  | 'saving'
  | 'done'
  | 'error'
