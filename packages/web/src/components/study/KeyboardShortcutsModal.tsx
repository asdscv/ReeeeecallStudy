import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'
import type { StudyMode } from '../../types/database'

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
  mode?: StudyMode
  isSwipeMode?: boolean
}

interface ShortcutEntry {
  keys: string[]
  label: string
}

export function KeyboardShortcutsModal({ open, onClose, mode = 'srs', isSwipeMode = false }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation('study')

  // Common shortcuts (all modes)
  const commonShortcuts: ShortcutEntry[] = [
    { keys: ['Space', 'Enter'], label: t('shortcuts.flipCard', 'Flip card (both directions)') },
    { keys: ['Ctrl+Z'], label: t('shortcuts.undoRating') },
    { keys: ['Escape'], label: t('shortcuts.exitStudy') },
    { keys: ['?'], label: t('shortcuts.toggleHelp') },
  ]

  // Mode-specific rating shortcuts (button mode only)
  const ratingShortcuts: ShortcutEntry[] = isSwipeMode
    ? [] // Swipe mode: no keyboard rating
    : mode === 'srs'
      ? [{ keys: ['1', '2', '3', '4'], label: t('shortcuts.rateCards', 'Again / Hard / Good / Easy') }]
      : mode === 'cramming'
        ? [
            { keys: ['\u2192'], label: t('shortcuts.gotIt', 'Got It') },
            { keys: ['\u2190'], label: t('shortcuts.missed', 'Missed') },
          ]
        : [
            { keys: ['\u2192'], label: t('shortcuts.known', 'Known') },
            { keys: ['\u2190'], label: t('shortcuts.unknown', 'Unknown') },
          ]

  const allShortcuts = [...ratingShortcuts, ...commonShortcuts]

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {allShortcuts.map((shortcut, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className="text-sm text-foreground">{shortcut.label}</span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 text-xs font-mono font-medium text-foreground bg-accent border border-border rounded"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}

          {isSwipeMode && (
            <div className="pt-2 text-xs text-muted-foreground text-center">
              {t('shortcuts.swipeHint', 'In swipe mode, swipe left/right to rate cards.')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
