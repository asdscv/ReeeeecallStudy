import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { useTemplateStore } from '../../stores/template-store'
import type { CardTemplate, TemplateField, LayoutItem } from '../../types/database'

interface TemplateFormModalProps {
  open: boolean
  onClose: () => void
  editTemplate?: CardTemplate | null
}

const FIELD_TYPES: { value: TemplateField['type']; labelKey: string }[] = [
  { value: 'text', labelKey: 'templates:fieldTypes.text' },
  { value: 'image', labelKey: 'templates:fieldTypes.image' },
  { value: 'audio', labelKey: 'templates:fieldTypes.audio' },
]

const STYLE_OPTIONS: { value: LayoutItem['style']; labelKey: string; descKey: string }[] = [
  { value: 'primary', labelKey: 'templates:styleOptions.primary', descKey: 'templates:styleOptions.primary' },
  { value: 'secondary', labelKey: 'templates:styleOptions.secondary', descKey: 'templates:styleOptions.secondary' },
  { value: 'hint', labelKey: 'templates:styleOptions.hint', descKey: 'templates:styleOptions.hint' },
  { value: 'detail', labelKey: 'templates:styleOptions.detail', descKey: 'templates:styleOptions.detail' },
  { value: 'media', labelKey: 'templates:styleOptions.media', descKey: 'templates:styleOptions.media' },
]

function generateKey(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function TemplateFormModal({ open, onClose, editTemplate }: TemplateFormModalProps) {
  const { t } = useTranslation('templates')
  const { createTemplate, updateTemplate } = useTemplateStore()

  const [name, setName] = useState('')
  const [fields, setFields] = useState<TemplateField[]>([])
  const [frontLayout, setFrontLayout] = useState<LayoutItem[]>([])
  const [backLayout, setBackLayout] = useState<LayoutItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'fields' | 'front' | 'back'>('fields')

  useEffect(() => {
    if (editTemplate) {
      setName(editTemplate.name)
      setFields([...editTemplate.fields])
      setFrontLayout([...editTemplate.front_layout])
      setBackLayout([...editTemplate.back_layout])
    } else {
      setName('')
      setFields([
        { key: 'front', name: t('defaultFields.front'), type: 'text', order: 0 },
        { key: 'back', name: t('defaultFields.back'), type: 'text', order: 1 },
      ])
      setFrontLayout([{ field_key: 'front', style: 'primary' }])
      setBackLayout([{ field_key: 'back', style: 'primary' }])
    }
    setActiveTab('fields')
  }, [editTemplate, open])

  // Field management
  const addField = () => {
    if (fields.length >= 10) return
    const newField: TemplateField = {
      key: generateKey(),
      name: t('form.fieldNumber', { number: fields.length + 1 }),
      type: 'text',
      order: fields.length,
    }
    setFields([...fields, newField])
  }

  const updateField = (index: number, updates: Partial<TemplateField>) => {
    const next = [...fields]
    next[index] = { ...next[index], ...updates }
    setFields(next)
  }

  const removeField = (index: number) => {
    if (fields.length <= 1) return
    const removed = fields[index]
    const next = fields.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i }))
    setFields(next)
    setFrontLayout(frontLayout.filter((l) => l.field_key !== removed.key))
    setBackLayout(backLayout.filter((l) => l.field_key !== removed.key))
  }

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    next.forEach((f, i) => (f.order = i))
    setFields(next)
  }

  // Layout management
  const toggleLayoutField = (
    layout: LayoutItem[],
    setLayout: (l: LayoutItem[]) => void,
    fieldKey: string,
  ) => {
    const exists = layout.find((l) => l.field_key === fieldKey)
    if (exists) {
      setLayout(layout.filter((l) => l.field_key !== fieldKey))
    } else {
      setLayout([...layout, { field_key: fieldKey, style: 'primary' }])
    }
  }

  const updateLayoutStyle = (
    layout: LayoutItem[],
    setLayout: (l: LayoutItem[]) => void,
    fieldKey: string,
    style: LayoutItem['style'],
  ) => {
    setLayout(layout.map((l) => (l.field_key === fieldKey ? { ...l, style } : l)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || fields.length === 0) return

    setLoading(true)

    if (editTemplate) {
      await updateTemplate(editTemplate.id, {
        name: name.trim(),
        fields,
        front_layout: frontLayout,
        back_layout: backLayout,
      })
    } else {
      await createTemplate({
        name: name.trim(),
        fields,
        front_layout: frontLayout,
        back_layout: backLayout,
      })
    }

    setLoading(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editTemplate ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Template name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t('form.templateName')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('form.namePlaceholder')}
              className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
              required
            />
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            {(['fields', 'front', 'back'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition ${
                  activeTab === tab
                    ? 'border-brand text-brand'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'fields' ? t('form.fieldsTab', { current: fields.length, max: 10 }) : tab === 'front' ? t('form.frontLayoutTab') : t('form.backLayoutTab')}
              </button>
            ))}
          </div>

          {/* Fields tab */}
          {activeTab === 'fields' && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {fields.map((field, i) => (
                <div key={field.key} className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveField(i, -1)}
                      disabled={i === 0}
                      className="text-xs text-content-tertiary hover:text-muted-foreground disabled:opacity-30 cursor-pointer"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(i, 1)}
                      disabled={i === fields.length - 1}
                      className="text-xs text-content-tertiary hover:text-muted-foreground disabled:opacity-30 cursor-pointer"
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    className="flex-1 px-3 py-1.5 rounded border border-border text-sm text-foreground outline-none focus:border-brand"
                    placeholder={t('form.fieldNamePlaceholder')}
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateField(i, { type: e.target.value as TemplateField['type'] })}
                    className="px-2 py-1.5 rounded border border-border text-sm text-foreground outline-none"
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>{t(ft.labelKey)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={fields.length <= 1}
                    className="text-content-tertiary hover:text-destructive disabled:opacity-30 cursor-pointer text-sm px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {fields.length < 10 && (
                <button
                  type="button"
                  onClick={addField}
                  className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-brand hover:text-brand cursor-pointer transition"
                >
                  {t('form.addField')}
                </button>
              )}
            </div>
          )}

          {/* Front/Back layout tabs */}
          {(activeTab === 'front' || activeTab === 'back') && (
            <LayoutEditor
              fields={fields}
              layout={activeTab === 'front' ? frontLayout : backLayout}
              onToggle={(key) =>
                toggleLayoutField(
                  activeTab === 'front' ? frontLayout : backLayout,
                  activeTab === 'front' ? setFrontLayout : setBackLayout,
                  key,
                )
              }
              onStyleChange={(key, style) =>
                updateLayoutStyle(
                  activeTab === 'front' ? frontLayout : backLayout,
                  activeTab === 'front' ? setFrontLayout : setBackLayout,
                  key,
                  style,
                )
              }
            />
          )}

          {/* Buttons */}
          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-muted cursor-pointer"
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand disabled:opacity-50 cursor-pointer"
            >
              {loading ? t('form.saving') : editTemplate ? t('form.save') : t('form.create')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LayoutEditor({
  fields,
  layout,
  onToggle,
  onStyleChange,
}: {
  fields: TemplateField[]
  layout: LayoutItem[]
  onToggle: (fieldKey: string) => void
  onStyleChange: (fieldKey: string, style: LayoutItem['style']) => void
}) {
  const { t } = useTranslation('templates')

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {fields.map((field) => {
        const layoutItem = layout.find((l) => l.field_key === field.key)
        const isSelected = !!layoutItem

        return (
          <div
            key={field.key}
            className={`p-3 rounded-lg border transition ${
              isSelected ? 'border-brand/30 bg-brand/10' : 'border-border bg-muted'
            }`}
          >
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(field.key)}
                  className="cursor-pointer"
                />
                <span className="text-sm font-medium text-foreground">{field.name}</span>
                <span className="text-xs text-content-tertiary">({field.type})</span>
              </label>
            </div>
            {isSelected && (
              <div className="flex flex-wrap gap-1.5 mt-2 ml-6">
                {STYLE_OPTIONS.map((style) => (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() => onStyleChange(field.key, style.value)}
                    className={`px-2.5 py-1 text-xs rounded-full cursor-pointer transition ${
                      layoutItem?.style === style.value
                        ? 'bg-brand text-white'
                        : 'bg-card border border-border text-muted-foreground hover:border-brand'
                    }`}
                    title={t(style.descKey)}
                  >
                    {t(style.labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {fields.length === 0 && (
        <p className="text-sm text-content-tertiary text-center py-4">{t('form.addFieldsFirst')}</p>
      )}
    </div>
  )
}
