import { useTranslation } from 'react-i18next'
import type { GeneratedTemplate, GeneratedTemplateField, GeneratedLayoutItem } from '../../../lib/ai/types'

interface ReviewTemplateStepProps {
  template: GeneratedTemplate
  onChange: (t: GeneratedTemplate) => void
  onRegenerate: () => void
  onNext: () => void
}

const STYLE_OPTIONS = ['primary', 'secondary', 'hint', 'detail'] as const
const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48]

export function ReviewTemplateStep({ template, onChange, onRegenerate, onNext }: ReviewTemplateStepProps) {
  const { t } = useTranslation('ai-generate')

  const updateField = (index: number, updates: Partial<GeneratedTemplateField>) => {
    const fields = [...template.fields]
    fields[index] = { ...fields[index], ...updates }
    onChange({ ...template, fields })
  }

  const removeField = (index: number) => {
    const field = template.fields[index]
    const fields = template.fields.filter((_, i) => i !== index)
    const front_layout = template.front_layout.filter((l) => l.field_key !== field.key)
    const back_layout = template.back_layout.filter((l) => l.field_key !== field.key)
    onChange({ ...template, fields, front_layout, back_layout })
  }

  const updateLayoutItem = (
    side: 'front' | 'back',
    index: number,
    updates: Partial<GeneratedLayoutItem>,
  ) => {
    const key = side === 'front' ? 'front_layout' : 'back_layout'
    const layout = [...template[key]]
    layout[index] = { ...layout[index], ...updates }
    onChange({ ...template, [key]: layout })
  }

  return (
    <div className="space-y-4">
      {/* Template name */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          {t('review.templateName')}
        </label>
        <input
          type="text"
          value={template.name}
          onChange={(e) => onChange({ ...template, name: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm outline-none focus:border-brand"
        />
      </div>

      {/* Fields */}
      <div>
        <h4 className="text-sm font-medium text-foreground mb-2">{t('review.fields')}</h4>
        <div className="space-y-2">
          {template.fields.map((field, i) => (
            <div key={field.key} className="flex items-center gap-2 p-2 bg-muted rounded-lg">
              <span className="text-xs text-content-tertiary w-6">{i + 1}</span>
              <input
                type="text"
                value={field.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                className="flex-1 px-2 py-1 text-sm border border-border rounded outline-none focus:border-brand"
              />
              <select
                value={field.tts_lang || ''}
                onChange={(e) => updateField(i, {
                  tts_lang: e.target.value || undefined,
                  tts_enabled: !!e.target.value,
                })}
                className="px-2 py-1 text-xs border border-border rounded outline-none"
              >
                <option value="">TTS off</option>
                <option value="ko-KR">Korean</option>
                <option value="en-US">English (US)</option>
                <option value="ja-JP">Japanese</option>
                <option value="zh-CN">Chinese (CN)</option>
                <option value="zh-TW">Chinese (TW)</option>
                <option value="es-ES">Spanish</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="vi-VN">Vietnamese</option>
                <option value="th-TH">Thai</option>
              </select>
              {template.fields.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeField(i)}
                  className="p-1 text-destructive/70 hover:text-destructive cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Front Layout */}
      <LayoutEditor
        label={t('review.frontLayout')}
        items={template.front_layout}
        fields={template.fields}
        onChange={(idx, updates) => updateLayoutItem('front', idx, updates)}
      />

      {/* Back Layout */}
      <LayoutEditor
        label={t('review.backLayout')}
        items={template.back_layout}
        fields={template.fields}
        onChange={(idx, updates) => updateLayoutItem('back', idx, updates)}
      />

      {/* Custom HTML */}
      {template.layout_mode === 'custom' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('review.frontHtml')}
            </label>
            <textarea
              value={template.front_html}
              onChange={(e) => onChange({ ...template, front_html: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-border text-xs font-mono outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('review.backHtml')}
            </label>
            <textarea
              value={template.back_html}
              onChange={(e) => onChange({ ...template, back_html: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-border text-xs font-mono outline-none focus:border-brand"
            />
          </div>
        </div>
      )}

      <p className="text-xs text-content-tertiary">{t('review.editTip')}</p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg text-sm hover:bg-muted cursor-pointer"
        >
          {t('review.regenerate')}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand cursor-pointer"
        >
          {t('review.next')}
        </button>
      </div>
    </div>
  )
}

function LayoutEditor({
  label,
  items,
  fields,
  onChange,
}: {
  label: string
  items: GeneratedLayoutItem[]
  fields: GeneratedTemplateField[]
  onChange: (index: number, updates: Partial<GeneratedLayoutItem>) => void
}) {
  if (items.length === 0) return null

  return (
    <div>
      <h4 className="text-sm font-medium text-foreground mb-2">{label}</h4>
      <div className="space-y-1">
        {items.map((item, i) => {
          const field = fields.find((f) => f.key === item.field_key)
          return (
            <div key={item.field_key} className="flex items-center gap-2 p-2 bg-muted rounded">
              <span className="text-xs text-muted-foreground min-w-[80px] truncate">{field?.name ?? item.field_key}</span>
              <select
                value={item.style}
                onChange={(e) => onChange(i, { style: e.target.value as GeneratedLayoutItem['style'] })}
                className="px-2 py-1 text-xs border border-border rounded outline-none"
              >
                {STYLE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={item.font_size ?? ''}
                onChange={(e) => onChange(i, { font_size: e.target.value ? Number(e.target.value) : undefined })}
                className="px-2 py-1 text-xs border border-border rounded outline-none"
              >
                <option value="">auto</option>
                {FONT_SIZE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </div>
  )
}
