import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTemplateStore } from '../stores/template-store'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { formatLocalDate } from '../lib/date-utils'
import type { CardTemplate } from '../types/database'

export function TemplatesPage() {
  const navigate = useNavigate()
  const { templates, loading, error, fetchTemplates, deleteTemplate, duplicateTemplate } = useTemplateStore()

  const [deletingTemplate, setDeletingTemplate] = useState<CardTemplate | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleEdit = (tmpl: CardTemplate) => {
    navigate(`/templates/${tmpl.id}/edit`)
  }

  const handleNew = () => {
    navigate('/templates/new/edit')
  }

  const handleDelete = async () => {
    if (!deletingTemplate) return
    setDeleteLoading(true)
    setDeleteError(null)
    const success = await deleteTemplate(deletingTemplate.id)
    if (!success) {
      setDeleteError(useTemplateStore.getState().error)
    }
    setDeleteLoading(false)
    if (success) setDeletingTemplate(null)
  }

  const handleDuplicate = async (tmpl: CardTemplate) => {
    await duplicateTemplate(tmpl.id)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📋</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">카드 템플릿</h1>
          <p className="text-sm text-gray-500 mt-1">
            카드의 필드 구성과 앞/뒷면 레이아웃을 관리합니다.
          </p>
        </div>
        <button
          onClick={handleNew}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
        >
          + 새 템플릿
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-500 mb-4">템플릿이 없습니다. 새 템플릿을 만들어보세요.</p>
          <button
            onClick={handleNew}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            + 첫 번째 템플릿 만들기
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((tmpl) => (
            <TemplateCard
              key={tmpl.id}
              template={tmpl}
              onEdit={() => handleEdit(tmpl)}
              onDelete={() => setDeletingTemplate(tmpl)}
              onDuplicate={() => handleDuplicate(tmpl)}
            />
          ))}
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deletingTemplate}
        onClose={() => { setDeletingTemplate(null); setDeleteError(null) }}
        onConfirm={handleDelete}
        title="템플릿 삭제"
        message={
          deleteError
            ? deleteError
            : `"${deletingTemplate?.name}" 템플릿을 삭제하시겠습니까?`
        }
        confirmLabel="삭제"
        danger
        loading={deleteLoading}
      />
    </div>
  )
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  template: CardTemplate
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-semibold text-gray-900 truncate">{template.name}</h3>
            {template.is_default && (
              <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded-full font-medium">
                기본
              </span>
            )}
          </div>

          {/* Fields summary */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {template.fields.map((field) => (
              <span
                key={field.key}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
              >
                {field.type === 'image' ? '🖼️' : field.type === 'audio' ? '🔊' : '📝'}
                {field.name}
              </span>
            ))}
          </div>

          {/* Layout preview */}
          <div className="flex gap-4 text-xs text-gray-400">
            <span>앞면: {template.front_layout.length}개 필드</span>
            <span>뒷면: {template.back_layout.length}개 필드</span>
            <span>생성: {formatLocalDate(template.created_at)}</span>
          </div>
        </div>

        {/* Menu */}
        <div className="relative ml-3">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 cursor-pointer"
          >
            ⋯
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                <button
                  onClick={() => { onEdit(); setShowMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  편집
                </button>
                <button
                  onClick={() => { onDuplicate(); setShowMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  복제
                </button>
                {!template.is_default && (
                  <button
                    onClick={() => { onDelete(); setShowMenu(false) }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    삭제
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
