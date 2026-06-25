// Display metadata for the canonical default ("preset") card templates that are
// seeded server-side by the signup trigger and migration 097
// (_seed_default_templates). These rows have Korean names/field names baked in,
// so the quick-create UI maps them to stable, translatable ids and each app
// resolves its own i18n label. Falls back to the raw template/field name when a
// row is not one of the known presets.
//
// Keep PRESET_ID_BY_TEMPLATE_NAME / FIELD_LABEL_ID_BY_NAME in sync with the
// seeded template names in supabase/migrations/097_ensure_default_templates.sql.

export type PresetId = 'basic' | 'english' | 'chinese'

/** Seeded template name → stable preset id used for a translatable label. */
const PRESET_ID_BY_TEMPLATE_NAME: Record<string, PresetId> = {
  '기본 (앞/뒤)': 'basic',
  '영어 단어': 'english',
  '중국어 단어': 'chinese',
}

/** Seeded template field name → stable, translatable field-label id. */
const FIELD_LABEL_ID_BY_NAME: Record<string, string> = {
  앞면: 'front',
  뒷면: 'back',
  Word: 'word',
  Meaning: 'meaning',
  Pronunciation: 'pronunciation',
  Example: 'example',
  한자: 'hanzi',
  뜻: 'meaning',
  병음: 'pinyin',
  예문: 'example',
  오디오: 'audio',
}

/** Stable preset id for a template name, or undefined if it is a custom template. */
export function presetIdForTemplate(templateName: string): PresetId | undefined {
  return PRESET_ID_BY_TEMPLATE_NAME[templateName]
}

/** Stable label id for a preset field name, or undefined for custom fields. */
export function fieldLabelId(fieldName: string): string | undefined {
  return FIELD_LABEL_ID_BY_NAME[fieldName]
}
