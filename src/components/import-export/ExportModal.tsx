import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { generateExportJSON, generateExportCSV } from '../../lib/import-export'
import type { Deck, CardTemplate, Card } from '../../types/database'

interface ExportModalProps {
  open: boolean
  onClose: () => void
  deck: Deck
  template: CardTemplate | null
  cards: Card[]
}

type ExportFormat = 'json' | 'csv'

export function ExportModal({ open, onClose, deck, template, cards }: ExportModalProps) {
  const { t } = useTranslation('import-export')
  const [format, setFormat] = useState<ExportFormat>('json')

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
      content = generateExportCSV(cards, template.fields)
      mimeType = 'text/csv;charset=utf-8'
      ext = 'csv'
    }

    // Add BOM for CSV to ensure Korean characters display correctly in Excel
    const bom = format === 'csv' ? '\uFEFF' : ''
    const blob = new Blob([bom + content], { type: mimeType })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `${deck.name}_${new Date().toISOString().slice(0, 10)}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('exportCards')}</DialogTitle>
        </DialogHeader>
        {!template ? (
          <p className="text-gray-500">{t('noTemplate')}</p>
        ) : cards.length === 0 ? (
          <p className="text-gray-500">{t('noCards')}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">{t('format')}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setFormat('json')}
                  className={`flex-1 p-4 rounded-xl border-2 text-left cursor-pointer transition ${
                    format === 'json'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium text-gray-900">JSON</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('jsonDesc')}
                  </p>
                </button>
                <button
                  onClick={() => setFormat('csv')}
                  className={`flex-1 p-4 rounded-xl border-2 text-left cursor-pointer transition ${
                    format === 'csv'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="font-medium text-gray-900">CSV</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('csvDesc')}
                  </p>
                </button>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
              {t('exportCount', { count: cards.length })}
            </div>

            <DialogFooter>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
              >
                {t('export')}
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
