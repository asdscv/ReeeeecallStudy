import { useTranslation } from 'react-i18next'
import type { SrsSettings, CardTemplate } from '../../types/database'

export const COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280',
]

export const ICONS = ['📚', '📖', '🇨🇳', '🇺🇸', '🇯🇵', '🧠', '💡', '📝']

export const SRS_FIELDS: { key: keyof SrsSettings; label: string; color: string }[] = [
  { key: 'again_days', label: 'Again', color: 'text-red-500' },
  { key: 'hard_days', label: 'Hard', color: 'text-amber-500' },
  { key: 'good_days', label: 'Good', color: 'text-blue-500' },
  { key: 'easy_days', label: 'Easy', color: 'text-green-500' },
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

  return (
    <div className="space-y-4">
      {/* 이름 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('settings.deckName')} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={t('settings.namePlaceholder')}
          required
          className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
        />
      </div>

      {/* 설명 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('settings.description')}
        </label>
        <textarea
          value={description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder={t('settings.descriptionPlaceholder')}
          rows={2}
          className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 resize-none"
        />
      </div>

      {/* 색상 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">{t('settings.color')}</label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => update({ color: c })}
              className={`w-8 h-8 rounded-full cursor-pointer transition-transform ${
                color === c ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* 아이콘 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">{t('settings.icon')}</label>
        <div className="flex flex-wrap gap-2">
          {ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              onClick={() => update({ icon: ic })}
              className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center cursor-pointer transition ${
                icon === ic
                  ? 'bg-blue-50 ring-2 ring-blue-500'
                  : 'bg-gray-50 hover:bg-gray-100'
              }`}
            >
              {ic}
            </button>
          ))}
        </div>
      </div>

      {/* 기본 템플릿 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('settings.defaultTemplate')}
        </label>
        <select
          value={templateId}
          onChange={(e) => update({ templateId: e.target.value })}
          className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('settings.srsInterval')}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SRS_FIELDS.map(({ key, label, color: clr }) => (
            <div key={key} className="text-center">
              <label className={`block text-xs font-semibold mb-1 ${clr}`}>
                {label}
              </label>
              <input
                type="number"
                value={srsSettings[key]}
                onChange={(e) => updateSrsField(key, parseInt(e.target.value) || 0)}
                min={0}
                max={365}
                className="w-full px-2 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 text-center text-sm"
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          {t('settings.srsNote')}
        </p>
      </div>
    </div>
  )
}
