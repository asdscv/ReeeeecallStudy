import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import {
  generateExportJSON,
  generateExportCSV,
  generateTemplateExportJSON,
  generateTemplateExportCSV,
} from '../../lib/import-export'
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
type ExportMode = 'cards' | 'template'

/** Replace characters that are unsafe in file names across OS platforms */
function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'export'
}

export function ExportModal({ open, onClose, deck, template, cards }: ExportModalProps) {
  const { t } = useTranslation('import-export')
  const hasCards = cards.length > 0

  // Bug fix: use initializer function to avoid flicker (0-card decks briefly showing cards tab)
  const [mode, setMode] = useState<ExportMode>(() => hasCards ? 'cards' : 'template')
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [step, setStep] = useState<ExportStep>('select')
  const [exportedFileName, setExportedFileName] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetState = useCallback(() => {
    setMode(hasCards ? 'cards' : 'template')
    setFormat('csv')
    setStep('select')
    setExportedFileName('')
    setIsExporting(false)
    setError(null)
  }, [hasCards])

  useEffect(() => {
    if (open) resetState()
  }, [open, resetState])

  const handleExport = () => {
    if (isExporting || !template) return
    setIsExporting(true)
    setError(null)

    let content: string
    let mimeType: string
    let ext: string

    if (mode === 'template') {
      if (format === 'json') {
        content = generateTemplateExportJSON(template)
        mimeType = 'application/json'
        ext = 'json'
      } else {
        content = generateTemplateExportCSV(template)
        mimeType = 'text/csv;charset=utf-8'
        ext = 'csv'
      }
    } else {
      if (format === 'json') {
        content = generateExportJSON(deck, template, cards)
        mimeType = 'application/json'
        ext = 'json'
      } else {
        content = generateExportCSV(cards, template.fields)
        mimeType = 'text/csv;charset=utf-8'
        ext = 'csv'
      }
    }

    const suffix = mode === 'template' ? '_template' : '_cards'
    const safeName = sanitizeFileName(deck.name)
    const fileName = `${safeName}${suffix}_${new Date().toISOString().slice(0, 10)}.${ext}`

    try {
      downloadFile(content, mimeType, fileName)
    } catch {
      setError(t('exportFailed'))
      setIsExporting(false)
      return
    }

    setIsExporting(false)
    setExportedFileName(fileName)
    setStep('done')
  }

  const modeTabs: { id: ExportMode; label: string }[] = [
    { id: 'cards', label: t('modeCards') },
    { id: 'template', label: t('modeTemplate') },
  ]

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('exportTitle')}</DialogTitle>
        </DialogHeader>

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center py-6 space-y-3">
            <div className="text-4xl" aria-hidden="true">✅</div>
            <p className="text-gray-900 font-medium">{t('exportComplete')}</p>
            <p className="text-sm text-gray-500">
              {t('exportFileSaved', { fileName: exportedFileName })}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer min-h-[44px]"
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
                {/* Mode tabs */}
                <div className="flex border-b border-gray-200" role="tablist">
                  {modeTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={mode === tab.id}
                      data-testid={`export-tab-${tab.id}`}
                      onClick={() => { setMode(tab.id); setFormat('csv'); setError(null) }}
                      className={`px-4 py-2.5 text-sm font-medium border-b-2 cursor-pointer transition min-h-[44px] ${
                        mode === tab.id
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Cards mode */}
                {mode === 'cards' && (
                  <div role="tabpanel" data-testid="export-panel-cards">
                    {!hasCards ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                        {t('noCardsForCardExport')}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-2">{t('format')}</p>
                          <div className="flex flex-col sm:flex-row gap-3" role="radiogroup" aria-label={t('format')}>
                            <button
                              type="button"
                              role="radio"
                              aria-checked={format === 'json'}
                              onClick={() => setFormat('json')}
                              className={`flex-1 p-4 rounded-xl border-2 text-left cursor-pointer transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                                format === 'json'
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <p className="font-medium text-gray-900">JSON</p>
                              <p className="text-xs text-gray-500 mt-1">{t('jsonDesc')}</p>
                            </button>
                            <button
                              type="button"
                              role="radio"
                              aria-checked={format === 'csv'}
                              onClick={() => setFormat('csv')}
                              className={`flex-1 p-4 rounded-xl border-2 text-left cursor-pointer transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                                format === 'csv'
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <p className="font-medium text-gray-900">CSV</p>
                              <p className="text-xs text-gray-500 mt-1">{t('csvDesc')}</p>
                            </button>
                          </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                          {t('exportCount', { count: cards.length })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Template mode */}
                {mode === 'template' && (
                  <div role="tabpanel" data-testid="export-panel-template">
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">{t('format')}</p>
                        <div className="flex flex-col sm:flex-row gap-3" role="radiogroup" aria-label={t('format')}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={format === 'json'}
                            onClick={() => setFormat('json')}
                            className={`flex-1 p-4 rounded-xl border-2 text-left cursor-pointer transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                              format === 'json'
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <p className="font-medium text-gray-900">JSON</p>
                            <p className="text-xs text-gray-500 mt-1">{t('templateJsonDesc')}</p>
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={format === 'csv'}
                            onClick={() => setFormat('csv')}
                            className={`flex-1 p-4 rounded-xl border-2 text-left cursor-pointer transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                              format === 'csv'
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <p className="font-medium text-gray-900">CSV</p>
                            <p className="text-xs text-gray-500 mt-1">{t('templateCsvDesc')}</p>
                          </button>
                        </div>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                        {t('templateExportInfo')}
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <DialogFooter>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer min-h-[44px]"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    data-testid="export-submit"
                    onClick={handleExport}
                    disabled={(mode === 'cards' && !hasCards) || isExporting}
                    className="px-4 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer min-h-[44px]"
                  >
                    {isExporting ? t('exporting') : t('export')}
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
