import { useState, useEffect } from 'react'
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

const FIELD_TYPES: { value: TemplateField['type']; label: string }[] = [
  { value: 'text', label: '텍스트' },
  { value: 'image', label: '이미지' },
  { value: 'audio', label: '오디오' },
]

const STYLE_OPTIONS: { value: LayoutItem['style']; label: string; desc: string }[] = [
  { value: 'primary', label: 'Primary', desc: '가장 큰 글씨' },
  { value: 'secondary', label: 'Secondary', desc: '보조 텍스트' },
  { value: 'hint', label: 'Hint', desc: '작은 힌트' },
  { value: 'detail', label: 'Detail', desc: '상세 정보' },
  { value: 'media', label: 'Media', desc: '이미지/오디오' },
]

function generateKey(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function TemplateFormModal({ open, onClose, editTemplate }: TemplateFormModalProps) {
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
        { key: 'front', name: '앞면', type: 'text', order: 0 },
        { key: 'back', name: '뒷면', type: 'text', order: 1 },
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
          <DialogTitle>{editTemplate ? '템플릿 수정' : '새 템플릿'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Template name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">템플릿 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 영어 단어장"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
              required
            />
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {(['fields', 'front', 'back'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'fields' ? `필드 (${fields.length}/10)` : tab === 'front' ? '앞면 레이아웃' : '뒷면 레이아웃'}
              </button>
            ))}
          </div>

          {/* Fields tab */}
          {activeTab === 'fields' && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {fields.map((field, i) => (
                <div key={field.key} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveField(i, -1)}
                      disabled={i === 0}
                      className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 cursor-pointer"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(i, 1)}
                      disabled={i === fields.length - 1}
                      className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 cursor-pointer"
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateField(i, { name: e.target.value })}
                    className="flex-1 px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-900 outline-none focus:border-blue-500"
                    placeholder="필드 이름"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateField(i, { type: e.target.value as TemplateField['type'] })}
                    className="px-2 py-1.5 rounded border border-gray-300 text-sm text-gray-700 outline-none"
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>{ft.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={fields.length <= 1}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30 cursor-pointer text-sm px-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {fields.length < 10 && (
                <button
                  type="button"
                  onClick={addField}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 cursor-pointer transition"
                >
                  + 필드 추가
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
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {loading ? '저장 중...' : editTemplate ? '수정' : '만들기'}
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
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {fields.map((field) => {
        const layoutItem = layout.find((l) => l.field_key === field.key)
        const isSelected = !!layoutItem

        return (
          <div
            key={field.key}
            className={`p-3 rounded-lg border transition ${
              isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'
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
                <span className="text-sm font-medium text-gray-700">{field.name}</span>
                <span className="text-xs text-gray-400">({field.type})</span>
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
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-400'
                    }`}
                    title={style.desc}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {fields.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">먼저 필드를 추가하세요.</p>
      )}
    </div>
  )
}
