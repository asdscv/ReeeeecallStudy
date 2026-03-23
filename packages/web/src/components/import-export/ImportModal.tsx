import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { useCardStore } from '../../stores/card-store'
import {
  parseImportJSON,
  parseImportCSV,
  validateImportCards,
  detectDuplicates,
  generateCSVTemplate,
} from '../../lib/import-export'
import type { ImportCard } from '../../lib/import-export'
import { decodeFileText } from '../../lib/decode-file'
import { downloadFile } from '../../lib/download-file'
import type { CardTemplate } from '../../types/database'
import { ImportProgressBar } from './ImportProgressBar'
import Papa from 'papaparse'

interface ImportModalProps {
  open: boolean
  onClose: () => void
  deckId: string
  templateId: string
  template: CardTemplate | null
  onComplete: () => void
}

type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'
type DuplicateMode = 'skip' | 'overwrite' | 'add'

export function ImportModal({ open, onClose, deckId, templateId, template, onComplete }: ImportModalProps) {
  const { t } = useTranslation('import-export')
  const { cards: existingCards, createCards, error: storeError } = useCardStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<ImportStep>('upload')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({})
  const [parsedCards, setParsedCards] = useState<ImportCard[]>([])
  const [invalidCount, setInvalidCount] = useState(0)
  const [duplicateCount, setDuplicateCount] = useState(0)
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState({ added: 0, skipped: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const downloadTemplate = useCallback(() => {
    if (!template) return
    const csv = generateCSVTemplate(template.fields)
    downloadFile(csv, 'text/csv;charset=utf-8', `${template.name}_template.csv`)
  }, [template])

  const resetState = useCallback(() => {
    setStep('upload')
    setCsvHeaders([])
    setFieldMapping({})
    setParsedCards([])
    setInvalidCount(0)
    setDuplicateCount(0)
    setDuplicateMode('skip')
    setProgress({ done: 0, total: 0 })
    setResult({ added: 0, skipped: 0, total: 0 })
    setError(null)
    setDragOver(false)
    try { sessionStorage.removeItem('__import_csv_raw') } catch { /* private browsing */ }
  }, [])

  // open → true 전환 시 상태 초기화 (close 시가 아님 → flash 방지)
  useEffect(() => {
    if (open) resetState()
  }, [open, resetState])

  const handleClose = () => {
    onClose()
  }

  const processFile = async (file: File) => {
    setError(null)
    const text = await decodeFileText(file)
    const ext = file.name.split('.').pop()?.toLowerCase()

    try {
      if (ext === 'json') {
        const parsed = parseImportJSON(text)
        const { valid, invalid } = validateImportCards(parsed.cards)
        const { duplicates } = detectDuplicates(existingCards, valid)

        setParsedCards(valid)
        setInvalidCount(invalid.length)
        setDuplicateCount(duplicates.length)
        setStep('preview')
      } else if (ext === 'csv') {
        const preview = Papa.parse<Record<string, string>>(text, { header: true, preview: 1 })
        const headers = preview.meta.fields ?? []
        setCsvHeaders(headers)

        // Auto-map headers to template fields by name match
        const autoMapping: Record<string, string> = {}
        if (template) {
          for (const header of headers) {
            const field = template.fields.find(
              (f) => f.name === header || f.key === header
            )
            if (field) {
              autoMapping[header] = field.key
            }
          }
        }
        setFieldMapping(autoMapping)

        // Store raw text for later parsing
        try { sessionStorage.setItem('__import_csv_raw', text) } catch { /* private browsing */ }
        setStep('mapping')
      } else {
        setError(t('unsupportedFormat'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('parseFailed'))
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleMappingConfirm = () => {
    let raw: string | null = null
    try { raw = sessionStorage.getItem('__import_csv_raw') } catch { /* private browsing */ }
    if (!raw) return

    try {
      const cards = parseImportCSV(raw, fieldMapping)
      const { valid, invalid } = validateImportCards(cards)
      const { duplicates } = detectDuplicates(existingCards, valid)

      setParsedCards(valid)
      setInvalidCount(invalid.length)
      setDuplicateCount(duplicates.length)
      setStep('preview')
      try { sessionStorage.removeItem('__import_csv_raw') } catch { /* private browsing */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('csvParseFailed'))
    }
  }

  const handleImport = async () => {
    if (!template) return
    setStep('importing')

    let cardsToImport = parsedCards
    if (duplicateMode === 'skip') {
      const { unique } = detectDuplicates(existingCards, parsedCards)
      cardsToImport = unique
    }

    setProgress({ done: 0, total: cardsToImport.length })

    const inserted = await createCards({
      deck_id: deckId,
      template_id: templateId,
      cards: cardsToImport.map(c => ({ field_values: c.field_values, tags: c.tags })),
      onProgress: (done, total) => setProgress({ done, total }),
    })

    setResult({
      added: inserted,
      skipped: parsedCards.length - inserted,
      total: parsedCards.length,
    })
    setStep('done')
  }

  const handleDone = () => {
    handleClose()
    onComplete()
  }

  const templateFields = template?.fields ?? []
  const previewCards = parsedCards.slice(0, 5)

  // importing 중에는 닫기 방지
  const canClose = step !== 'importing'

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && canClose) handleClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('importCards')}</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
            {t(error)}
          </div>
        )}

        {/* Step: Upload */}
        {step === 'upload' && (
          <div
            className={`border-2 border-dashed rounded-xl p-6 sm:p-10 text-center transition ${
              dragOver ? 'border-brand bg-brand/10' : 'border-border'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="text-4xl mb-3">📁</div>
            <p className="text-muted-foreground mb-2">{t('dragFile')}</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition cursor-pointer"
            >
              {t('selectFile')}
            </button>
            <p className="text-content-tertiary text-xs mt-3">{t('supportedFormats')}</p>
            {template && (
              <button
                onClick={downloadTemplate}
                className="mt-2 px-3 py-1.5 text-brand text-xs underline cursor-pointer"
              >
                {t('downloadTemplate')}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Step: CSV Mapping */}
        {step === 'mapping' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('mapHeaders')}
            </p>
            <div className="space-y-2">
              {csvHeaders
                .filter((h) => h !== 'Tags' && h !== '태그')
                .map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <span className="shrink-0 w-24 sm:w-32 text-sm text-foreground truncate">{header}</span>
                    <span className="text-content-tertiary">→</span>
                    <select
                      value={fieldMapping[header] ?? ''}
                      onChange={(e) =>
                        setFieldMapping((prev) => ({ ...prev, [header]: e.target.value }))
                      }
                      className="flex-1 px-3 py-1.5 rounded-lg border border-border text-sm outline-none"
                    >
                      <option value="">{t('skipField')}</option>
                      {templateFields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.name} ({f.key})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
            <DialogFooter>
              <button
                onClick={() => { resetState(); setStep('upload') }}
                className="px-4 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-muted cursor-pointer"
              >
                {t('back')}
              </button>
              <button
                onClick={handleMappingConfirm}
                disabled={Object.values(fieldMapping).filter(Boolean).length === 0}
                className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand disabled:opacity-50 cursor-pointer"
              >
                {t('next')}
              </button>
            </DialogFooter>
          </div>
        )}

        {/* Step: Preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm">
              <span className="px-3 py-1 bg-brand/10 text-brand rounded-full">
                {t('validCount', { count: parsedCards.length })}
              </span>
              {invalidCount > 0 && (
                <span className="px-3 py-1 bg-destructive/10 text-destructive rounded-full">
                  {t('invalidCount', { count: invalidCount })}
                </span>
              )}
              {duplicateCount > 0 && (
                <span className="px-3 py-1 bg-warning/10 text-warning rounded-full">
                  {t('duplicateCount', { count: duplicateCount })}
                </span>
              )}
            </div>

            {/* Preview Table */}
            {previewCards.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-xs text-muted-foreground">#</th>
                      {templateFields.slice(0, 3).map((f) => (
                        <th key={f.key} className="text-left py-2 px-2 text-xs text-muted-foreground">
                          {f.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewCards.map((card, i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="py-2 px-2 text-content-tertiary">{i + 1}</td>
                        {templateFields.slice(0, 3).map((f) => (
                          <td key={f.key} className="py-2 px-2 text-foreground truncate max-w-[200px]">
                            {card.field_values[f.key] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedCards.length > 5 && (
                  <p className="text-xs text-content-tertiary mt-1">
                    {t('moreCards', { count: parsedCards.length - 5 })}
                  </p>
                )}
              </div>
            )}

            {/* Duplicate handling */}
            {duplicateCount > 0 && (
              <div>
                <p className="text-sm font-medium text-foreground mb-2">{t('duplicateHandling')}</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['skip', 'skip'],
                    ['overwrite', 'overwrite'],
                    ['add', 'addNew'],
                  ] as const).map(([value, labelKey]) => (
                    <button
                      key={value}
                      onClick={() => setDuplicateMode(value)}
                      className={`px-3 py-1.5 text-sm rounded-lg border cursor-pointer ${
                        duplicateMode === value
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {t(`duplicateMode.${labelKey}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <button
                onClick={() => {
                  resetState()
                }}
                className="px-4 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-muted cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleImport}
                disabled={parsedCards.length === 0}
                className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand disabled:opacity-50 cursor-pointer"
              >
                {t('import', { count: parsedCards.length })}
              </button>
            </DialogFooter>
          </div>
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <ImportProgressBar done={progress.done} total={progress.total} label={t('importing')} />
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center py-6 space-y-3">
            <div className="text-4xl">{storeError ? '⚠️' : '✅'}</div>
            <p className="text-foreground font-medium">{t('importComplete')}</p>
            <p className="text-sm text-muted-foreground">
              {t('importSummary', { total: result.total, added: result.added, skipped: result.skipped })}
            </p>
            {storeError && (
              <p className="text-sm text-destructive">{storeError}</p>
            )}
            <button
              onClick={handleDone}
              className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand cursor-pointer"
            >
              {t('confirm')}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
