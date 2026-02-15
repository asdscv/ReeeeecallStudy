import { useState, useRef, useCallback } from 'react'
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
} from '../../lib/import-export'
import type { ImportCard } from '../../lib/import-export'
import type { CardTemplate } from '../../types/database'
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
  const { cards: existingCards, createCard } = useCardStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<ImportStep>('upload')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({})
  const [parsedCards, setParsedCards] = useState<ImportCard[]>([])
  const [invalidCount, setInvalidCount] = useState(0)
  const [duplicateCount, setDuplicateCount] = useState(0)
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip')
  const [result, setResult] = useState({ added: 0, skipped: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const resetState = useCallback(() => {
    setStep('upload')
    setCsvHeaders([])
    setFieldMapping({})
    setParsedCards([])
    setInvalidCount(0)
    setDuplicateCount(0)
    setDuplicateMode('skip')
    setResult({ added: 0, skipped: 0, total: 0 })
    setError(null)
    setDragOver(false)
  }, [])

  const handleClose = () => {
    resetState()
    onClose()
  }

  const processFile = async (file: File) => {
    setError(null)
    const text = await file.text()
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
        sessionStorage.setItem('__import_csv_raw', text)
        setStep('mapping')
      } else {
        setError('JSON 또는 CSV 파일만 지원합니다.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일 파싱에 실패했습니다.')
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
    const raw = sessionStorage.getItem('__import_csv_raw')
    if (!raw) return

    try {
      const cards = parseImportCSV(raw, fieldMapping)
      const { valid, invalid } = validateImportCards(cards)
      const { duplicates } = detectDuplicates(existingCards, valid)

      setParsedCards(valid)
      setInvalidCount(invalid.length)
      setDuplicateCount(duplicates.length)
      setStep('preview')
      sessionStorage.removeItem('__import_csv_raw')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSV 파싱에 실패했습니다.')
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

    let added = 0
    const batchSize = 1000

    for (let i = 0; i < cardsToImport.length; i += batchSize) {
      const batch = cardsToImport.slice(i, i + batchSize)
      for (const card of batch) {
        const created = await createCard({
          deck_id: deckId,
          template_id: templateId,
          field_values: card.field_values,
          tags: card.tags,
        })
        if (created) added++
      }
    }

    setResult({
      added,
      skipped: parsedCards.length - added,
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>카드 가져오기</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {/* Step: Upload */}
        {step === 'upload' && (
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center transition ${
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="text-4xl mb-3">📁</div>
            <p className="text-gray-600 mb-2">파일을 여기에 드래그하거나</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
            >
              파일 선택
            </button>
            <p className="text-gray-400 text-xs mt-3">JSON 또는 CSV 파일 지원</p>
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
            <p className="text-sm text-gray-600">
              CSV 헤더를 템플릿 필드에 매핑해주세요.
            </p>
            <div className="space-y-2">
              {csvHeaders
                .filter((h) => h !== '태그')
                .map((header) => (
                  <div key={header} className="flex items-center gap-3">
                    <span className="w-32 text-sm text-gray-700 truncate">{header}</span>
                    <span className="text-gray-400">→</span>
                    <select
                      value={fieldMapping[header] ?? ''}
                      onChange={(e) =>
                        setFieldMapping((prev) => ({ ...prev, [header]: e.target.value }))
                      }
                      className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm outline-none"
                    >
                      <option value="">-- 건너뛰기 --</option>
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
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                뒤로
              </button>
              <button
                onClick={handleMappingConfirm}
                disabled={Object.values(fieldMapping).filter(Boolean).length === 0}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                다음
              </button>
            </DialogFooter>
          </div>
        )}

        {/* Step: Preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="flex items-center gap-3 text-sm">
              <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full">
                유효 {parsedCards.length}개
              </span>
              {invalidCount > 0 && (
                <span className="px-3 py-1 bg-red-50 text-red-700 rounded-full">
                  무효 {invalidCount}개
                </span>
              )}
              {duplicateCount > 0 && (
                <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full">
                  중복 {duplicateCount}개
                </span>
              )}
            </div>

            {/* Preview Table */}
            {previewCards.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 text-xs text-gray-500">#</th>
                      {templateFields.slice(0, 3).map((f) => (
                        <th key={f.key} className="text-left py-2 px-2 text-xs text-gray-500">
                          {f.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewCards.map((card, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-2 px-2 text-gray-400">{i + 1}</td>
                        {templateFields.slice(0, 3).map((f) => (
                          <td key={f.key} className="py-2 px-2 text-gray-700 truncate max-w-[200px]">
                            {card.field_values[f.key] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedCards.length > 5 && (
                  <p className="text-xs text-gray-400 mt-1">
                    ... 외 {parsedCards.length - 5}개
                  </p>
                )}
              </div>
            )}

            {/* Duplicate handling */}
            {duplicateCount > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">중복 카드 처리</p>
                <div className="flex gap-2">
                  {([
                    ['skip', '건너뛰기'],
                    ['overwrite', '덮어쓰기'],
                    ['add', '새로 추가'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setDuplicateMode(value)}
                      className={`px-3 py-1.5 text-sm rounded-lg border cursor-pointer ${
                        duplicateMode === value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {label}
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
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={handleImport}
                disabled={parsedCards.length === 0}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                가져오기 ({parsedCards.length}개)
              </button>
            </DialogFooter>
          </div>
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3 animate-pulse">📥</div>
            <p className="text-gray-600">가져오는 중...</p>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="text-center py-6 space-y-3">
            <div className="text-4xl">✅</div>
            <p className="text-gray-900 font-medium">가져오기 완료</p>
            <p className="text-sm text-gray-500">
              총 {result.total}개 중 {result.added}개 추가, {result.skipped}개 건너뜀
            </p>
            <button
              onClick={handleDone}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              확인
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
