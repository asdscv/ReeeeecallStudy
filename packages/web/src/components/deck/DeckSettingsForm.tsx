import { useTranslation } from 'react-i18next'
import type { SrsSettings, CardTemplate } from '../../types/database'

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
  srsSettings: SrsSettings
}

interface DeckSettingsFormProps {
  values: DeckSettingsFormValues
  onChange: (values: DeckSettingsFormValues) => void
  templates: CardTemplate[]
}

export function DeckSettingsForm({ values, onChange, templates }: DeckSettingsFormProps) {
  const { t } = useTranslation('decks')
  const { name, description, color, icon, templateId, srsSettings } = values

  const update = (patch: Partial<DeckSettingsFormValues>) => {
    onChange({ ...values, ...patch })
  }

  const updateSrsField = (key: keyof SrsSettings, value: number) => {
    update({ srsSettings: { ...srsSettings, [key]: Math.max(0, Math.min(365, value)) } })
  }

  const learningStepsStr = (srsSettings.learning_steps ?? [1, 10]).join(', ')
  const updateLearningSteps = (raw: string) => {
    const steps = raw
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 0 && n <= 1440)
    update({ srsSettings: { ...srsSettings, learning_steps: steps } })
  }

  return (
    <div className="space-y-4">
      {/* 이름 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          {t('settings.deckName')} <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={t('settings.namePlaceholder')}
          required
          className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
        />
      </div>

      {/* 설명 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          {t('settings.description')}
        </label>
        <textarea
          value={description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder={t('settings.descriptionPlaceholder')}
          rows={2}
          className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground resize-none"
        />
      </div>

      {/* 색상 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t('settings.color')}</label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => update({ color: c })}
              className={`w-8 h-8 rounded-full cursor-pointer transition-transform ${
                color === c ? 'ring-2 ring-offset-2 ring-brand scale-110' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* 아이콘 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t('settings.icon')}</label>
        <div className="flex flex-wrap gap-2">
          {ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              onClick={() => update({ icon: ic })}
              className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center cursor-pointer transition ${
                icon === ic
                  ? 'bg-brand/10 ring-2 ring-brand'
                  : 'bg-muted hover:bg-accent'
              }`}
            >
              {ic}
            </button>
          ))}
        </div>
      </div>

      {/* 기본 템플릿 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          {t('settings.defaultTemplate')}
        </label>
        <select
          value={templateId}
          onChange={(e) => update({ templateId: e.target.value })}
          className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
        >
          <option value="">{t('settings.noSelection')}</option>
          {templates.map((tmpl) => (
            <option key={tmpl.id} value={tmpl.id}>
              {tmpl.name} {tmpl.is_default ? t('settings.defaultLabel') : ''}
            </option>
          ))}
        </select>
      </div>

      {/* SRS 간격 설정 */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          {t('settings.srsInterval')}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SRS_FIELDS.map(({ key, labelKey, color: clr }) => (
            <div key={key} className="text-center">
              <label className={`block text-xs font-semibold mb-1 ${clr}`}>
                {t(labelKey)}
              </label>
              <input
                type="number"
                value={srsSettings[key] as number}
                onChange={(e) => updateSrsField(key, parseInt(e.target.value) || 0)}
                min={0}
                max={365}
                className="w-full px-2 py-2 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground text-center text-sm"
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-content-tertiary mt-1.5">
          {t('settings.srsNote')}
        </p>
      </div>

      {/* Learning Steps */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          {t('settings.learningSteps')}
        </label>
        <input
          type="text"
          value={learningStepsStr}
          onChange={(e) => updateLearningSteps(e.target.value)}
          placeholder="1, 10"
          className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
        />
        <p className="text-xs text-content-tertiary mt-1.5">
          {t('settings.learningStepsNote')}
        </p>
      </div>

      {/* Max Interval */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          {t('settings.maxInterval')}
        </label>
        <input
          type="number"
          value={srsSettings.max_interval_days ?? 365}
          onChange={(e) => {
            const raw = e.target.value
            update({ srsSettings: { ...srsSettings, max_interval_days: raw === '' ? ('' as any) : (parseInt(raw) || 0) } })
          }}
          onBlur={() => {
            const n = typeof srsSettings.max_interval_days === 'number' ? srsSettings.max_interval_days : 365
            update({ srsSettings: { ...srsSettings, max_interval_days: Math.max(1, Math.min(3650, n || 365)) } })
          }}
          min={1}
          max={3650}
          className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
        />
        <p className="text-xs text-content-tertiary mt-1.5">
          {t('settings.maxIntervalNote')}
        </p>
      </div>
    </div>
  )
}
