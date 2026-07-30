import type { SrsSettings } from '../types/database'

/** Deck appearance + SRS form options and the shape the deck forms exchange.
 *  Kept out of the component file so DeckSettingsForm exports only a component
 *  (fast refresh) and so the two deck forms share one definition of the values. */
export const COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
]

export const ICONS = ['📚', '📖', '🇨🇳', '🇺🇸', '🇯🇵', '🧠', '💡', '📝']

export const SRS_FIELDS: { key: keyof SrsSettings; labelKey: string; color: string }[] = [
  { key: 'again_days', labelKey: 'study:srsRating.again', color: 'text-destructive' },
  { key: 'hard_days', labelKey: 'study:srsRating.hard', color: 'text-warning' },
  { key: 'good_days', labelKey: 'study:srsRating.good', color: 'text-brand' },
  { key: 'easy_days', labelKey: 'study:srsRating.easy', color: 'text-success' },
]

export interface DeckSettingsFormValues {
  name: string
  description: string
  color: string
  icon: string
  templateId: string
  learningLanguage: string
  nativeLanguages: string[]
  studyLevel: string
  srsSettings: SrsSettings
}
