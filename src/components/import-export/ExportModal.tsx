import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { generateExportJSON, generateExportCSV, generateCSVTemplate } from '../../lib/import-export'
import { downloadFile } from '../../lib/download-file'
import type { Deck, CardTemplate, Card } from '../../types/database'

interface ExportModalProps {
  open: boolean
  onClose: () => void
  deck: Deck
  template: CardTemplate | null
  cards: Card[]
}

type ExportFormat = 'json' | 'csv'
type ExportStep = 'select' | 'done'

export function ExportModal({ open, onClose, deck, template, cards }: ExportModalProps) {
  const { t } = useTranslation('import-export')
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [step, setStep] = useState<ExportStep>('select')
  const [exportedFileName, setExportedFileName] = useState('')

  const hasCards = cards.length > 0

  const resetState = useCallback(() => {
    setFormat('csv')
    setStep('select')
    setExportedFileName('')
  }, [])

  // open → true 전환 시 상태 초기화 (ImportModal과 동일한 패턴)
  useEffect(() => {
    if (open) resetState()
  }, [open, resetState])

  const handleClose = () => {
    onClose()
  }

  const handleExport = () => {
    if (!template) return

    let content: string
    let mimeType: string
    let ext: string

    if (format === 'json') {
      content = generateExportJSON(deck, template, cards)
      mimeType = 'application/json'
      ext = 'json'
    } else {
      // CSV: use full export if cards exist, otherwise template-only
      content = hasCards
        ? generateExportCSV(cards, template.fields)
        : generateCSVTemplate(template.fields)
      mimeType = 'text/csv;charset=utf-8'
      ext = 'csv'
    }

    const suffix = !hasCards && format === 'csv' ? '_template' : ''
    const fileName = `${deck.name}${suffix}_${new Date().toISOString().slice(0, 10)}.${ext}`
    downloadFile(content, mimeType, fileName)

    setExportedFileName(fileName)
    setStep('done')
  }

  // When no cards, force CSV format (JSON needs card data)
  const effectiveFormat = !hasCards ? 'csv' : format

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('exportCards')}</DialogTitle>
        </DialogHeader>

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center py-6 space-y-3">
            <div className="text-4xl">✅</div>
            <p className="text-gray-900 font-medium">{t('exportComplete')}</p>
            <p className="text-sm text-gray-500">
              {t('exportFileSaved', { fileName: exportedFileName })}
            </p>
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              {t('confirm')}
            </button>
          </div>
        )}

        {/* Step: Select */}
        {step === 'select' && (
          <>
            {!template ? (
              <p className="text-gray-500">{t('noTemplate')}</p>
            ) : (
              <div className="space-y-4">
                {/* Empty deck hint */}
                {!hasCards && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                    {t('emptyDeckHint')}
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">{t('format')}</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={() => hasCards && setFormat('json')}
                      disabled={!hasCards}
                      className={`flex-1 p-4 rounded-xl border-2 text-left transition ${
                        !hasCards
                          ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                          : effectiveFormat === 'json'
                            ? 'border-blue-500 bg-blue-50 cursor-pointer'
                            : 'border-gray-200 hover:border-gray-300 cursor-pointer'
                      }`}
                    >
                      <p className={`font-medium ${!hasCards ? 'text-gray-400' : 'text-gray-900'}`}>JSON</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {t('jsonDesc')}
                      </p>
                      {!hasCards && (
                        <p className="text-xs text-gray-400 mt-1">{t('jsonDisabledNoCards')}</p>
                      )}
                    </button>
                    <button
                      onClick={() => setFormat('csv')}
                      className={`flex-1 p-4 rounded-xl border-2 text-left cursor-pointer transition ${
                        effectiveFormat === 'csv'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="font-medium text-gray-900">CSV</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {hasCards ? t('csvDesc') : t('csvTemplateDesc')}
                      </p>
                    </button>
                  </div>
                </div>

                {/* Card count info */}
                {hasCards && (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                    {t('exportCount', { count: cards.length })}
                  </div>
                )}

                <DialogFooter>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={effectiveFormat === 'json' && !hasCards}
                    className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                  >
                    {hasCards ? t('export') : t('exportTemplate')}
                  </button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
