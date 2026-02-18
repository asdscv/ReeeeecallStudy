import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, GripVertical, X, ChevronDown, Save, Volume2, Trash2 } from 'lucide-react'
import { useTemplateStore } from '../stores/template-store'
import { toast } from 'sonner'
import { speak, stopSpeaking } from '../lib/tts'
import { renderCustomHTML } from '../lib/template-renderer'
import { FONT_SIZE_OPTIONS, getLayoutItemStyle, DEFAULT_FONT_SIZES } from '../lib/layout-styles'
import type { TemplateField, LayoutItem, LayoutMode } from '../types/database'

const STYLE_OPTIONS: { value: LayoutItem['style']; labelKey: string }[] = [
  { value: 'primary', labelKey: 'styleOptions.primary' },
  { value: 'secondary', labelKey: 'styleOptions.secondary' },
  { value: 'hint', labelKey: 'styleOptions.hint' },
  { value: 'detail', labelKey: 'styleOptions.detail' },
  { value: 'media', labelKey: 'styleOptions.media' },
]

function getTtsLanguages(t: (key: string) => string) {
  return [
    { value: '', label: t('ttsLanguageSelect') },
    { value: 'ko-KR', label: t('ttsKorean') },
    { value: 'en-US', label: 'English (US)' },
    { value: 'en-GB', label: 'English (UK)' },
    { value: 'ja-JP', label: '日本語' },
    { value: 'zh-CN', label: '中文 (简体)' },
    { value: 'zh-TW', label: '中文 (繁體)' },
    { value: 'es-ES', label: 'Español' },
    { value: 'fr-FR', label: 'Français' },
    { value: 'de-DE', label: 'Deutsch' },
    { value: 'pt-BR', label: 'Português' },
    { value: 'vi-VN', label: 'Tiếng Việt' },
    { value: 'th-TH', label: 'ไทย' },
  ]
}

function generateKey(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function TemplateEditPage() {
  const { t } = useTranslation('templates')
  const TTS_LANGUAGES = getTtsLanguages(t)
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()
  const { templates, fetchTemplates, createTemplate, updateTemplate } = useTemplateStore()

  const isNew = templateId === 'new'
  const template = templates.find((t) => t.id === templateId)

  const [name, setName] = useState('')
  const [fields, setFields] = useState<TemplateField[]>([])
  const [frontLayout, setFrontLayout] = useState<LayoutItem[]>([])
  const [backLayout, setBackLayout] = useState<LayoutItem[]>([])
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('default')
  const [frontHtml, setFrontHtml] = useState('')
  const [backHtml, setBackHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Drag state for fields
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Dropdown state for layout field add
  const [frontDropdownOpen, setFrontDropdownOpen] = useState(false)
  const [backDropdownOpen, setBackDropdownOpen] = useState(false)

  // Always fetch fresh templates on mount to ensure layout_mode etc. are up-to-date
  useEffect(() => {
    fetchTemplates()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset loaded flag when templateId changes (navigating between templates)
  useEffect(() => {
    setLoaded(false)
  }, [templateId])

  useEffect(() => {
    if (loaded) return
    if (isNew) {
      setName('')
      setFields([
        { key: 'front', name: t('edit.front'), type: 'text', order: 0 },
        { key: 'back', name: t('edit.back'), type: 'text', order: 1 },
      ])
      setFrontLayout([{ field_key: 'front', style: 'primary' }])
      setBackLayout([{ field_key: 'back', style: 'primary' }])
      setLayoutMode('default')
      setFrontHtml('')
      setBackHtml('')
      setLoaded(true)
    } else if (template) {
      setName(template.name)
      setFields([...template.fields])
      setFrontLayout([...template.front_layout])
      setBackLayout([...template.back_layout])
      setLayoutMode(template.layout_mode ?? 'default')
      setFrontHtml(template.front_html ?? '')
      setBackHtml(template.back_html ?? '')
      setLoaded(true)
    }
  }, [isNew, template, loaded])

  // Field management
  const addField = () => {
    if (fields.length >= 10) return
    const newField: TemplateField = {
      key: generateKey(),
      name: t('edit.fieldDefault', { index: fields.length + 1 }),
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
    setFrontLayout((prev) => prev.filter((l) => l.field_key !== removed.key))
    setBackLayout((prev) => prev.filter((l) => l.field_key !== removed.key))
  }

  // TTS toggle
  const toggleTts = (index: number) => {
    const field = fields[index]
    updateField(index, { tts_enabled: !field.tts_enabled, tts_lang: field.tts_enabled ? undefined : (field.tts_lang || '') })
  }

  const handleTtsTest = (index: number) => {
    const field = fields[index]
    if (!field.tts_lang) {
      toast.error(t('edit.selectLanguage'))
      return
    }
    stopSpeaking()
    speak(field.name || t('edit.test'), field.tts_lang)
  }

  // Drag & drop for fields reorder
  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const next = [...fields]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(index, 0, moved)
    next.forEach((f, i) => (f.order = i))
    setFields(next)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  // Layout management
  const addLayoutField = (
    side: 'front' | 'back',
    fieldKey: string,
  ) => {
    if (side === 'front') {
      if (frontLayout.some((l) => l.field_key === fieldKey)) return
      setFrontLayout([...frontLayout, { field_key: fieldKey, style: 'primary' }])
      setFrontDropdownOpen(false)
    } else {
      if (backLayout.some((l) => l.field_key === fieldKey)) return
      setBackLayout([...backLayout, { field_key: fieldKey, style: 'primary' }])
      setBackDropdownOpen(false)
    }
  }

  const removeLayoutField = (side: 'front' | 'back', fieldKey: string) => {
    if (side === 'front') {
      setFrontLayout(frontLayout.filter((l) => l.field_key !== fieldKey))
    } else {
      setBackLayout(backLayout.filter((l) => l.field_key !== fieldKey))
    }
  }

  const updateLayoutStyle = (
    side: 'front' | 'back',
    fieldKey: string,
    style: LayoutItem['style'],
  ) => {
    if (side === 'front') {
      setFrontLayout(frontLayout.map((l) => (l.field_key === fieldKey ? { ...l, style } : l)))
    } else {
      setBackLayout(backLayout.map((l) => (l.field_key === fieldKey ? { ...l, style } : l)))
    }
  }

  const updateLayoutFontSize = (
    side: 'front' | 'back',
    fieldKey: string,
    fontSize: number | undefined,
  ) => {
    if (side === 'front') {
      setFrontLayout(frontLayout.map((l) => (l.field_key === fieldKey ? { ...l, font_size: fontSize } : l)))
    } else {
      setBackLayout(backLayout.map((l) => (l.field_key === fieldKey ? { ...l, font_size: fontSize } : l)))
    }
  }

  const getFieldName = useCallback(
    (fieldKey: string) => fields.find((f) => f.key === fieldKey)?.name ?? fieldKey,
    [fields],
  )

  // Save
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t('edit.nameRequired'))
      return
    }
    if (fields.length === 0) {
      toast.error(t('edit.fieldsRequired'))
      return
    }

    // Clean up TTS props for non-enabled fields
    const finalFields = fields.map((f) =>
      f.tts_enabled ? f : { ...f, tts_enabled: undefined, tts_lang: undefined },
    )

    setSaving(true)
    if (isNew) {
      const created = await createTemplate({
        name: name.trim(),
        fields: finalFields,
        front_layout: frontLayout,
        back_layout: backLayout,
        layout_mode: layoutMode,
        front_html: frontHtml,
        back_html: backHtml,
      })
      if (created) {
        toast.success(t('edit.created'))
        navigate('/templates', { replace: true })
      } else {
        toast.error(t('edit.createFailed'))
      }
    } else {
      const success = await updateTemplate(templateId!, {
        name: name.trim(),
        fields: finalFields,
        front_layout: frontLayout,
        back_layout: backLayout,
        layout_mode: layoutMode,
        front_html: frontHtml,
        back_html: backHtml,
      })
      if (success) {
        toast.success(t('edit.saved'))
      } else {
        toast.error(t('edit.saveFailed'))
      }
    }
    setSaving(false)
  }

  // Loading state
  if (!isNew && !template && templates.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500 mb-4">{t('edit.notFound')}</p>
        <button
          onClick={() => navigate('/templates')}
          className="text-blue-600 hover:text-blue-700 text-sm font-medium cursor-pointer"
        >
          {t('edit.backToList')}
        </button>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📋</div>
      </div>
    )
  }

  // Available fields for adding to layout
  const availableFrontFields = fields.filter(
    (f) => !frontLayout.some((l) => l.field_key === f.key),
  )
  const availableBackFields = fields.filter(
    (f) => !backLayout.some((l) => l.field_key === f.key),
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            onClick={() => navigate('/templates')}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 cursor-pointer shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('form.templateName')}
            className="text-lg sm:text-2xl font-bold text-gray-900 bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition px-1 min-w-0 w-full"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 sm:py-2.5 bg-blue-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition shrink-0"
        >
          <Save size={16} />
          <span className="hidden sm:inline">{saving ? `${t('common:saving')}...` : t('common:save')}</span>
          <span className="sm:hidden">{saving ? '...' : t('common:save')}</span>
        </button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Field Management */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">{t('edit.fieldManagement')}</h2>
            <span className="text-xs sm:text-sm text-gray-400">
              {t('edit.fieldCount', { count: fields.length })}
            </span>
          </div>

          <div className="space-y-2">
            {fields.map((field, i) => (
              <div key={field.key}>
                <div
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 p-3 rounded-lg border transition ${
                    dragOverIndex === i
                      ? 'border-blue-400 bg-blue-50'
                      : dragIndex === i
                        ? 'opacity-50 border-gray-200 bg-gray-50'
                        : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  {/* Drag handle */}
                  <div className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600">
                    <GripVertical size={16} />
                  </div>

                  {/* Number */}
                  <span className="text-xs text-gray-400 font-mono w-5 text-center">
                    {i + 1}
                  </span>

                  {/* Field name */}
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-900 outline-none focus:border-blue-500 transition"
                    placeholder={t('edit.fieldName')}
                  />

                  {/* Type label (text only) */}
                  <span className="hidden sm:inline px-2 py-1.5 text-sm text-gray-400">
                    {t('edit.text')}
                  </span>

                  {/* TTS toggle */}
                  {field.type === 'text' && (
                    <label className="flex items-center gap-0.5 cursor-pointer px-1">
                      <Volume2 size={14} className="text-gray-400" />
                      <input
                        type="checkbox"
                        checked={!!field.tts_enabled}
                        onChange={() => toggleTts(i)}
                        className="cursor-pointer accent-blue-600"
                      />
                    </label>
                  )}

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={fields.length <= 1}
                    className="p-1.5 text-red-400 hover:text-red-500 disabled:opacity-30 cursor-pointer rounded-lg hover:bg-red-50 transition"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Per-field detail (description) */}
                <div className="ml-8 mr-2 mt-1">
                  <input
                    type="text"
                    value={field.detail || ''}
                    onChange={(e) => updateField(i, { detail: e.target.value || undefined })}
                    className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 outline-none focus:border-blue-400 transition bg-white"
                    placeholder={t('edit.fieldDescription')}
                  />
                </div>

                {/* Per-field TTS settings (directly below the field) */}
                {field.tts_enabled && (
                  <div className="ml-8 mr-2 mt-1 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100">
                    <Volume2 size={14} className="text-blue-500 shrink-0" />
                    <select
                      value={field.tts_lang || ''}
                      onChange={(e) => updateField(i, { tts_lang: e.target.value })}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-900 outline-none cursor-pointer focus:border-blue-500 transition bg-white"
                    >
                      {TTS_LANGUAGES.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleTtsTest(i)}
                      className="px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-200 cursor-pointer transition shrink-0"
                    >
                      {t('edit.test')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {fields.length < 10 && (
            <button
              type="button"
              onClick={addField}
              className="w-full mt-3 py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 cursor-pointer transition"
            >
              {t('edit.addField')}
            </button>
          )}
        </div>

        {/* Right: Layout mode toggle + Front & Back layout */}
        <div className="space-y-6">
          {/* Layout mode toggle */}
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3">{t('edit.layoutMode')}</h2>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setLayoutMode('default')}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition cursor-pointer ${
                  layoutMode === 'default'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('edit.defaultMode')}
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('custom')}
                className={`flex-1 px-4 py-2.5 text-sm font-medium transition cursor-pointer ${
                  layoutMode === 'custom'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('edit.customMode')}
              </button>
            </div>
            {layoutMode === 'custom' && (
              <p className="text-xs text-gray-400 mt-2">
                {t('edit.htmlHelp', { curly: '{{' })}
              </p>
            )}
          </div>

          {layoutMode === 'default' ? (
            <>
              {/* Front layout */}
              <LayoutSection
                title={t('edit.frontSettings')}
                layout={frontLayout}
                fields={fields}
                availableFields={availableFrontFields}
                dropdownOpen={frontDropdownOpen}
                setDropdownOpen={setFrontDropdownOpen}
                onAdd={(key) => addLayoutField('front', key)}
                onRemove={(key) => removeLayoutField('front', key)}
                onStyleChange={(key, style) => updateLayoutStyle('front', key, style)}
                onFontSizeChange={(key, size) => updateLayoutFontSize('front', key, size)}
                getFieldName={getFieldName}
              />

              {/* Back layout */}
              <LayoutSection
                title={t('edit.backSettings')}
                layout={backLayout}
                fields={fields}
                availableFields={availableBackFields}
                dropdownOpen={backDropdownOpen}
                setDropdownOpen={setBackDropdownOpen}
                onAdd={(key) => addLayoutField('back', key)}
                onRemove={(key) => removeLayoutField('back', key)}
                onStyleChange={(key, style) => updateLayoutStyle('back', key, style)}
                onFontSizeChange={(key, size) => updateLayoutFontSize('back', key, size)}
                getFieldName={getFieldName}
              />
            </>
          ) : (
            <>
              {/* Custom HTML: Front */}
              <CustomHtmlSection
                title={t('edit.frontHtml')}
                html={frontHtml}
                onHtmlChange={setFrontHtml}
                fields={fields}
              />

              {/* Custom HTML: Back */}
              <CustomHtmlSection
                title={t('edit.backHtml')}
                html={backHtml}
                onHtmlChange={setBackHtml}
                fields={fields}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Layout Section Component ----

function LayoutSection({
  title,
  layout,
  fields,
  availableFields,
  dropdownOpen,
  setDropdownOpen,
  onAdd,
  onRemove,
  onStyleChange,
  onFontSizeChange,
  getFieldName,
}: {
  title: string
  layout: LayoutItem[]
  fields: TemplateField[]
  availableFields: TemplateField[]
  dropdownOpen: boolean
  setDropdownOpen: (v: boolean) => void
  onAdd: (fieldKey: string) => void
  onRemove: (fieldKey: string) => void
  onStyleChange: (fieldKey: string, style: LayoutItem['style']) => void
  onFontSizeChange: (fieldKey: string, fontSize: number | undefined) => void
  getFieldName: (key: string) => string
}) {
  const { t } = useTranslation('templates')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">{title}</h2>

      {/* Layout fields */}
      <div className="space-y-2 mb-3">
        {layout.map((item) => (
          <div
            key={item.field_key}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-green-50 border border-green-200 rounded-lg flex-wrap"
          >
            <span className="text-xs sm:text-sm font-medium text-gray-700 flex-1 min-w-[50px]">
              {getFieldName(item.field_key)}
            </span>
            <select
              value={item.style}
              onChange={(e) => onStyleChange(item.field_key, e.target.value as LayoutItem['style'])}
              className="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 outline-none cursor-pointer"
            >
              {STYLE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.labelKey)}
                </option>
              ))}
            </select>
            <select
              value={item.font_size ?? ''}
              onChange={(e) => {
                const val = e.target.value
                onFontSizeChange(item.field_key, val ? Number(val) : undefined)
              }}
              className="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 outline-none cursor-pointer"
              title={t('edit.fontSize')}
            >
              <option value="">
                {t('edit.defaultFontSize', { size: DEFAULT_FONT_SIZES[item.style] })}
              </option>
              {FONT_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onRemove(item.field_key)}
              className="p-1 text-red-400 hover:text-red-600 cursor-pointer rounded hover:bg-red-50 transition"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {layout.length === 0 && (
          <p className="text-sm text-gray-400 py-2">{t('edit.addFieldsFirst')}</p>
        )}
      </div>

      {/* Add field dropdown */}
      {availableFields.length > 0 && (
        <div className="relative mb-4">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 cursor-pointer font-medium"
          >
            {t('edit.addField')}
            <ChevronDown size={14} />
          </button>
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                {availableFields.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => onAdd(f.key)}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    {f.name}
                    <span className="text-xs text-gray-400 ml-1">({f.type})</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      <div className="border-t border-gray-200 pt-4">
        <p className="text-xs text-gray-400 mb-2">{t('edit.preview')}</p>
        <CardPreview layout={layout} fields={fields} getFieldName={getFieldName} />
      </div>
    </div>
  )
}

// ---- Custom HTML Section Component ----

function CustomHtmlSection({
  title,
  html,
  onHtmlChange,
  fields,
}: {
  title: string
  html: string
  onHtmlChange: (html: string) => void
  fields: TemplateField[]
}) {
  const { t } = useTranslation('templates')

  // Build sample values using field names for preview
  const sampleValues: Record<string, string> = {}
  for (const field of fields) {
    sampleValues[field.key] = `[${field.name}]`
  }

  const renderedPreview = renderCustomHTML(
    html,
    sampleValues,
    fields.map((f) => ({ key: f.key, name: f.name })),
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3">{title}</h2>

      {/* Field name chips */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {fields.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onHtmlChange(html + `{{${f.name}}}`)}
            className="px-2.5 py-1 text-xs bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 cursor-pointer transition font-medium"
            title={t('insertField', { name: f.name })}
          >
            {`{{${f.name}}}`}
          </button>
        ))}
      </div>

      {/* HTML textarea */}
      <textarea
        value={html}
        onChange={(e) => onHtmlChange(e.target.value)}
        rows={8}
        className="w-full px-4 py-3 rounded-lg border border-gray-300 text-sm text-gray-900 font-mono outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition resize-y"
        placeholder={`<div style="text-align:center">\n  <h1>{{${fields[0]?.name ?? 'Front'}}}</h1>\n</div>`}
      />

      {/* Live preview */}
      {html.trim() && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <p className="text-xs text-gray-400 mb-2">{t('edit.preview')}</p>
          <div
            className="bg-gray-50 rounded-xl border border-gray-200 p-6 min-h-[80px] prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderedPreview }}
          />
        </div>
      )}
    </div>
  )
}

// ---- Card Preview Component ----

function CardPreview({
  layout,
  fields,
  getFieldName,
}: {
  layout: LayoutItem[]
  fields: TemplateField[]
  getFieldName: (key: string) => string
}) {
  const { t } = useTranslation('templates')

  if (layout.length === 0) {
    return (
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">{t('edit.noFieldsToDisplay')}</p>
      </div>
    )
  }

  const getFieldType = (fieldKey: string) => fields.find((f) => f.key === fieldKey)?.type ?? 'text'

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 min-h-[120px] flex flex-col items-center justify-center gap-3">
      {layout.map((item, idx) => {
        const fieldType = getFieldType(item.field_key)
        const fieldName = getFieldName(item.field_key)

        if (fieldType === 'image' || item.style === 'media') {
          return (
            <div
              key={item.field_key}
              className="w-24 h-16 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 text-xs"
            >
              {fieldType === 'audio' ? '🔊 ' + fieldName : '🖼️ ' + fieldName}
            </div>
          )
        }

        if (fieldType === 'audio') {
          return (
            <div
              key={item.field_key}
              className="flex items-center gap-1 text-gray-400 text-sm"
            >
              🔊 {fieldName}
            </div>
          )
        }

        const { className, fontSize } = getLayoutItemStyle(item.style, item.font_size)
        // Scale down preview font sizes to fit the smaller preview box
        const previewFontSize = Math.min(fontSize * 0.6, 32)

        // Divider before hint/detail
        const prevStyle = idx > 0 ? layout[idx - 1].style : null
        const needsDivider =
          idx > 0 &&
          (item.style === 'hint' || item.style === 'detail') &&
          (prevStyle === 'primary' || prevStyle === 'secondary')

        return (
          <div key={item.field_key} className="w-full text-center">
            {needsDivider && (
              <div className="w-8 h-px bg-gray-200 mx-auto mb-2" />
            )}
            <div
              className={className}
              style={{ fontSize: `${previewFontSize}px`, lineHeight: previewFontSize >= 20 ? 1.2 : 1.5 }}
            >
              {fieldName}
            </div>
          </div>
        )
      })}
    </div>
  )
}
