import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, GripVertical, X, ChevronDown, Save, Volume2, Trash2 } from 'lucide-react'
import { useTemplateStore } from '../stores/template-store'
import { toast } from 'sonner'
import { speak, stopSpeaking } from '../lib/tts'
import type { TemplateField, LayoutItem } from '../types/database'

const FIELD_TYPES: { value: TemplateField['type']; label: string }[] = [
  { value: 'text', label: '텍스트' },
  { value: 'image', label: '이미지' },
  { value: 'audio', label: '오디오' },
]

const STYLE_OPTIONS: { value: LayoutItem['style']; label: string }[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'hint', label: 'Hint' },
  { value: 'detail', label: 'Detail' },
  { value: 'media', label: 'Media' },
]

const TTS_LANGUAGES = [
  { value: '', label: '언어 선택' },
  { value: 'ko-KR', label: '한국어' },
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

function generateKey(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function TemplateEditPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()
  const { templates, fetchTemplates, createTemplate, updateTemplate } = useTemplateStore()

  const isNew = templateId === 'new'
  const template = templates.find((t) => t.id === templateId)

  const [name, setName] = useState('')
  const [fields, setFields] = useState<TemplateField[]>([])
  const [frontLayout, setFrontLayout] = useState<LayoutItem[]>([])
  const [backLayout, setBackLayout] = useState<LayoutItem[]>([])
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Drag state for fields
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Dropdown state for layout field add
  const [frontDropdownOpen, setFrontDropdownOpen] = useState(false)
  const [backDropdownOpen, setBackDropdownOpen] = useState(false)

  useEffect(() => {
    if (templates.length === 0) fetchTemplates()
  }, [templates.length, fetchTemplates])

  useEffect(() => {
    if (loaded) return
    if (isNew) {
      setName('')
      setFields([
        { key: 'front', name: '앞면', type: 'text', order: 0 },
        { key: 'back', name: '뒷면', type: 'text', order: 1 },
      ])
      setFrontLayout([{ field_key: 'front', style: 'primary' }])
      setBackLayout([{ field_key: 'back', style: 'primary' }])
      setLoaded(true)
    } else if (template) {
      setName(template.name)
      setFields([...template.fields])
      setFrontLayout([...template.front_layout])
      setBackLayout([...template.back_layout])
      setLoaded(true)
    }
  }, [isNew, template, loaded])

  // Field management
  const addField = () => {
    if (fields.length >= 10) return
    const newField: TemplateField = {
      key: generateKey(),
      name: `필드 ${fields.length + 1}`,
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
      toast.error('언어를 선택해주세요')
      return
    }
    stopSpeaking()
    speak(field.name || '테스트', field.tts_lang)
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

  const getFieldName = useCallback(
    (fieldKey: string) => fields.find((f) => f.key === fieldKey)?.name ?? fieldKey,
    [fields],
  )

  // Save
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('템플릿 이름을 입력해주세요.')
      return
    }
    if (fields.length === 0) {
      toast.error('필드를 1개 이상 추가해주세요.')
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
      })
      if (created) {
        toast.success('템플릿이 생성되었습니다.')
        navigate('/templates', { replace: true })
      }
    } else {
      await updateTemplate(templateId!, {
        name: name.trim(),
        fields: finalFields,
        front_layout: frontLayout,
        back_layout: backLayout,
      })
      toast.success('템플릿이 저장되었습니다.')
    }
    setSaving(false)
  }

  // Loading state
  if (!isNew && !template && templates.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500 mb-4">템플릿을 찾을 수 없습니다.</p>
        <button
          onClick={() => navigate('/templates')}
          className="text-blue-600 hover:text-blue-700 text-sm font-medium cursor-pointer"
        >
          템플릿 목록으로 돌아가기
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
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/templates')}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="템플릿 이름"
            className="text-2xl font-bold text-gray-900 bg-transparent outline-none border-b-2 border-transparent focus:border-blue-500 transition px-1"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition"
        >
          <Save size={16} />
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Field Management */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">필드 관리</h2>
            <span className="text-sm text-gray-400">
              (최대 10개, 현재 {fields.length}개)
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
                    placeholder="필드 이름"
                  />

                  {/* Type dropdown */}
                  <select
                    value={field.type}
                    onChange={(e) => updateField(i, { type: e.target.value as TemplateField['type'] })}
                    className="px-2 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none cursor-pointer"
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>
                        {ft.label}
                      </option>
                    ))}
                  </select>

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
                      테스트
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
              + 필드 추가
            </button>
          )}
        </div>

        {/* Right: Front & Back layout */}
        <div className="space-y-6">
          {/* Front layout */}
          <LayoutSection
            title="앞면 설정"
            layout={frontLayout}
            fields={fields}
            availableFields={availableFrontFields}
            dropdownOpen={frontDropdownOpen}
            setDropdownOpen={setFrontDropdownOpen}
            onAdd={(key) => addLayoutField('front', key)}
            onRemove={(key) => removeLayoutField('front', key)}
            onStyleChange={(key, style) => updateLayoutStyle('front', key, style)}
            getFieldName={getFieldName}
          />

          {/* Back layout */}
          <LayoutSection
            title="뒷면 설정"
            layout={backLayout}
            fields={fields}
            availableFields={availableBackFields}
            dropdownOpen={backDropdownOpen}
            setDropdownOpen={setBackDropdownOpen}
            onAdd={(key) => addLayoutField('back', key)}
            onRemove={(key) => removeLayoutField('back', key)}
            onStyleChange={(key, style) => updateLayoutStyle('back', key, style)}
            getFieldName={getFieldName}
          />
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
  getFieldName: (key: string) => string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>

      {/* Layout fields */}
      <div className="space-y-2 mb-3">
        {layout.map((item) => (
          <div
            key={item.field_key}
            className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg"
          >
            <span className="text-sm font-medium text-gray-700 flex-1">
              {getFieldName(item.field_key)}
            </span>
            <select
              value={item.style}
              onChange={(e) => onStyleChange(item.field_key, e.target.value as LayoutItem['style'])}
              className="px-2 py-1 text-xs rounded-lg border border-gray-300 text-gray-600 outline-none cursor-pointer"
            >
              {STYLE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
          <p className="text-sm text-gray-400 py-2">필드를 추가해주세요.</p>
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
            + 필드 추가
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
        <p className="text-xs text-gray-400 mb-2">미리보기</p>
        <CardPreview layout={layout} fields={fields} getFieldName={getFieldName} />
      </div>
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
  if (layout.length === 0) {
    return (
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-400">표시할 필드가 없습니다</p>
      </div>
    )
  }

  const getFieldType = (fieldKey: string) => fields.find((f) => f.key === fieldKey)?.type ?? 'text'

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 min-h-[120px] flex flex-col items-center justify-center gap-2">
      {layout.map((item) => {
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

        const styleMap: Record<string, string> = {
          primary: 'text-2xl font-bold text-gray-900',
          secondary: 'text-lg text-gray-700',
          hint: 'text-sm text-gray-400',
          detail: 'text-sm text-gray-500',
          media: 'text-sm text-gray-400',
        }

        return (
          <div key={item.field_key} className={styleMap[item.style] ?? 'text-base text-gray-700'}>
            {fieldName}
          </div>
        )
      })}
    </div>
  )
}
