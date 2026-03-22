import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
  isSwipeMode?: boolean
}

interface ShortcutEntry {
  keys: string[]
  label: string
}

export function KeyboardShortcutsModal({ open, onClose, isSwipeMode = false }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation('study')

  const shortcuts: ShortcutEntry[] = isSwipeMode
    ? [
        { keys: ['Space'], label: t('shortcuts.flipCard', 'Flip card') },
        { keys: ['Ctrl+Z'], label: t('shortcuts.undoRating') },
        { keys: ['Escape'], label: t('shortcuts.exitStudy') },
        { keys: ['?'], label: t('shortcuts.toggleHelp') },
      ]
    : [
        { keys: ['1', '2', '3', '4'], label: t('shortcuts.rateCards') },
        { keys: ['Space'], label: t('shortcuts.flipCard', 'Flip card') },
        { keys: ['Ctrl+Z'], label: t('shortcuts.undoRating') },
        { keys: ['Escape'], label: t('shortcuts.exitStudy') },
        { keys: ['?'], label: t('shortcuts.toggleHelp') },
      ]

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {shortcuts.map((shortcut, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-700">{shortcut.label}</span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 text-xs font-mono font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}

          {isSwipeMode && (
            <div className="pt-2 text-xs text-gray-500 text-center">
              {t('shortcuts.swipeHint', 'In swipe mode, swipe left/right to rate cards.')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
