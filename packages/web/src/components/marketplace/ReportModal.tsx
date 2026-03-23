import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useReportStore } from '../../stores/report-store'
import type { ReportCategory } from '../../types/database'

const REPORT_CATEGORIES: { value: ReportCategory; labelKey: string }[] = [
  { value: 'inappropriate', labelKey: 'marketplace:report.categories.inappropriate' },
  { value: 'copyright', labelKey: 'marketplace:report.categories.copyright' },
  { value: 'spam', labelKey: 'marketplace:report.categories.spam' },
  { value: 'misleading', labelKey: 'marketplace:report.categories.misleading' },
  { value: 'other', labelKey: 'marketplace:report.categories.other' },
]

interface ReportModalProps {
  open: boolean
  onClose: () => void
  listingId: string
}

export function ReportModal({ open, onClose, listingId }: ReportModalProps) {
  const { t } = useTranslation(['marketplace', 'common'])
  const { submitReport, submitting, submitError } = useReportStore()
  const [category, setCategory] = useState<ReportCategory>('inappropriate')
  const [description, setDescription] = useState('')
  const [success, setSuccess] = useState(false)

  if (!open) return null

  const handleSubmit = async () => {
    const result = await submitReport(listingId, category, description.trim() || undefined)
    if (result) {
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setDescription('')
        setCategory('inappropriate')
        onClose()
      }, 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card rounded-xl shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('marketplace:report.title', { defaultValue: 'Report Content' })}
          </h2>
          <button onClick={onClose} className="p-1 text-content-tertiary hover:text-muted-foreground cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-8">
            <p className="text-success font-medium">
              {t('marketplace:report.submitted', { defaultValue: 'Report submitted. Thank you!' })}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t('marketplace:report.categoryLabel', { defaultValue: 'Reason' })}
                </label>
                <div className="space-y-2">
                  {REPORT_CATEGORIES.map((cat) => (
                    <label
                      key={cat.value}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                        category === cat.value
                          ? 'border-brand bg-brand/10'
                          : 'border-border hover:border-border'
                      }`}
                    >
                      <input
                        type="radio"
                        name="report-category"
                        value={cat.value}
                        checked={category === cat.value}
                        onChange={() => setCategory(cat.value)}
                        className="text-brand"
                      />
                      <span className="text-sm text-foreground">
                        {t(cat.labelKey, { defaultValue: cat.value })}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('marketplace:report.descriptionLabel', { defaultValue: 'Details (optional)' })}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none resize-none"
                  placeholder={t('marketplace:report.descriptionPlaceholder', { defaultValue: 'Describe the issue...' })}
                />
              </div>

              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {t('common:cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 bg-destructive text-white rounded-lg text-sm font-medium hover:bg-destructive transition disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? t('marketplace:report.submitting', { defaultValue: 'Submitting...' })
                  : t('marketplace:report.submit', { defaultValue: 'Submit Report' })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
