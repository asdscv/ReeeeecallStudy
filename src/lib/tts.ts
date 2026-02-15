import type { Card, CardTemplate, Profile } from '../types/database'

export function speak(text: string, lang: string = 'en-US'): void {
  if (!('speechSynthesis' in window)) return

  stopSpeaking()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = 0.9
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export function speakWithProfile(text: string, profile: Pick<Profile, 'tts_enabled' | 'tts_lang'>): void {
  if (!profile.tts_enabled) return
  speak(text, profile.tts_lang)
}

export function getCardTTSText(card: Card, template: CardTemplate): string | null {
  // Find the first text field from front_layout
  for (const item of template.front_layout) {
    const field = template.fields.find((f) => f.key === item.field_key)
    if (field && field.type === 'text') {
      const value = card.field_values[field.key]
      if (value) return value
    }
  }
  return null
}

export interface TTSFieldInfo {
  fieldKey: string
  text: string
  lang: string
}

export function getTTSFieldsForLayout(
  card: Card,
  template: CardTemplate,
  side: 'front' | 'back',
): TTSFieldInfo[] {
  const layout = side === 'front' ? template.front_layout : template.back_layout
  const result: TTSFieldInfo[] = []

  for (const item of layout) {
    const field = template.fields.find((f) => f.key === item.field_key)
    if (!field || field.type !== 'text' || !field.tts_enabled) continue

    const value = card.field_values[field.key]
    if (!value) continue

    result.push({
      fieldKey: field.key,
      text: value,
      lang: field.tts_lang || 'en-US',
    })
  }

  return result
}

export function getCardAudioUrl(card: Card, template: CardTemplate): string | null {
  // Find first audio type field that has a URL value
  for (const field of template.fields) {
    if (field.type === 'audio') {
      const url = card.field_values[field.key]
      if (url) return url
    }
  }
  return null
}
