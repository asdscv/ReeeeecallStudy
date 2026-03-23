import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toIntlLocale } from '../lib/locale-utils'
import { toast } from 'sonner'
import { useTemplateStore } from '../stores/template-store'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { formatLocalDate } from '../lib/date-utils'
import { generateTemplateExportJSON, generateTemplateExportCSV } from '../lib/import-export'
import { GuideHelpLink } from '../components/common/GuideHelpLink'
import type { CardTemplate } from '../types/database'

export function TemplatesPage() {
  const { t } = useTranslation('templates')
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

  const downloadFile = (content: string, filename: string, mimeType: string, addBom = false) => {
    const bom = addBom ? '\uFEFF' : ''
    const blob = new Blob([bom + content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportJSON = (tmpl: CardTemplate) => {
    const json = generateTemplateExportJSON(tmpl)
    const date = new Date().toISOString().slice(0, 10)
    downloadFile(json, `template_${tmpl.name}_${date}.json`, 'application/json')
    toast.success(t('exported'))
  }

  const handleExportCSV = (tmpl: CardTemplate) => {
    const csv = generateTemplateExportCSV(tmpl)
    const date = new Date().toISOString().slice(0, 10)
    downloadFile(csv, `template_${tmpl.name}_${date}.csv`, 'text/csv', true)
    toast.success(t('exported'))
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
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('title')}</h1>
            <GuideHelpLink section="templates" />
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {t('subtitle')}
          </p>
        </div>
        <button
          onClick={handleNew}
          className="px-3 sm:px-4 py-2 bg-brand text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-brand transition cursor-pointer shrink-0"
        >
          {t('createNew')}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
          {t(error)}
        </div>
      )}

      {templates.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 sm:p-12 text-center">
          <div className="text-4xl sm:text-5xl mb-4">📋</div>
          <p className="text-muted-foreground mb-4 text-sm sm:text-base">{t('empty')}</p>
          <button
            onClick={handleNew}
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition cursor-pointer"
          >
            {t('createFirst')}
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
              onExportJSON={() => handleExportJSON(tmpl)}
              onExportCSV={() => handleExportCSV(tmpl)}
            />
          ))}
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deletingTemplate}
        onClose={() => { setDeletingTemplate(null); setDeleteError(null) }}
        onConfirm={handleDelete}
        title={t('deleteTemplate')}
        message={
          deleteError
            ? t(deleteError)
            : t('deleteConfirm', { name: deletingTemplate?.name })
        }
        confirmLabel={t('common:delete')}
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
  onExportJSON,
  onExportCSV,
}: {
  template: CardTemplate
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onExportJSON: () => void
  onExportCSV: () => void
}) {
  const { t, i18n } = useTranslation('templates')
  const dateLocale = toIntlLocale(i18n.language)

  return (
    <div className="bg-card rounded-xl border border-border p-3 sm:p-5 hover:shadow-sm transition">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
          <h3 className="text-base sm:text-lg font-semibold text-foreground truncate">{template.name}</h3>
          {template.is_default && (
            <span className="px-2 py-0.5 text-xs bg-brand/10 text-brand rounded-full font-medium">
              {t('defaultBadge')}
            </span>
          )}
        </div>

        {/* Fields summary */}
        <div className="flex flex-wrap gap-1 sm:gap-1.5 mb-2 sm:mb-3">
          {template.fields.map((field) => (
            <span
              key={field.key}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent text-muted-foreground text-xs rounded-full"
            >
              {field.type === 'image' ? '🖼️' : field.type === 'audio' ? '🔊' : '📝'}
              {field.name}
            </span>
          ))}
        </div>

        {/* Layout preview */}
        <div className="flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-0.5 text-[10px] sm:text-xs text-content-tertiary mb-3">
          <span>{t('frontFields', { count: template.front_layout.length })}</span>
          <span>{t('backFields', { count: template.back_layout.length })}</span>
          <span>{t('created', { date: formatLocalDate(template.created_at, dateLocale) })}</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-accent rounded-lg transition cursor-pointer"
          >
            <span>✏️</span>
            <span className="hidden sm:inline">{t('common:edit')}</span>
          </button>
          <button
            onClick={onDuplicate}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-accent rounded-lg transition cursor-pointer"
          >
            <span>📋</span>
            <span className="hidden sm:inline">{t('common:duplicate')}</span>
          </button>
          <button
            onClick={onExportJSON}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-accent rounded-lg transition cursor-pointer"
          >
            <span>📄</span>
            <span className="hidden sm:inline">{t('exportJSON')}</span>
          </button>
          <button
            onClick={onExportCSV}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-accent rounded-lg transition cursor-pointer"
          >
            <span>📊</span>
            <span className="hidden sm:inline">{t('exportCSV')}</span>
          </button>
          {!template.is_default && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-destructive bg-destructive/10 hover:bg-destructive/15 rounded-lg transition cursor-pointer ml-auto"
            >
              <span>🗑️</span>
              <span className="hidden sm:inline">{t('common:delete')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
