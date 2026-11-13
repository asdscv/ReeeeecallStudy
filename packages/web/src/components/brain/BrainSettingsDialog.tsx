import { useTranslation } from 'react-i18next'
import { TIMING_MODES, type TimingMode } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'

/**
 * Relaxed timing and sound. Choice reaction time slows with age, so timed games can be given 1.5×
 * or 2× the time (a timeout then costs no chance) or no limit at all.
 */
const TIMING_KEY: Record<TimingMode, string> = { 1: 'settings.timing_1', 1.5: 'settings.timing_1_5', 2: 'settings.timing_2', 0: 'settings.timing_0' }

export function BrainSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('brain')
  const settings = useBrainStore((s) => s.progress.settings)
  const setSettings = useBrainStore((s) => s.setSettings)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>
        <section className="space-y-2">
          <p className="text-base font-medium text-foreground">{t('settings.timing')}</p>
          <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-muted" role="radiogroup" aria-label={t('settings.timing')}>
            {TIMING_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.timing === mode}
                onClick={() => setSettings({ timing: mode })}
                className={`min-h-12 rounded-lg text-sm font-medium border-none cursor-pointer ${
                  settings.timing === mode ? 'bg-card text-brand-active shadow-sm' : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
                data-testid={`brain-timing-${mode}`}
              >
                {t(TIMING_KEY[mode])}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t('settings.timingHelp')}</p>
        </section>
        <section className="space-y-2">
          <label className="flex items-center justify-between gap-3 min-h-12 cursor-pointer">
            <span className="text-base font-medium text-foreground">{t('settings.sound')}</span>
            <input
              type="checkbox"
              checked={settings.sound}
              onChange={(e) => setSettings({ sound: e.target.checked })}
              className="w-6 h-6 accent-[var(--brand)] cursor-pointer"
              data-testid="brain-sound"
            />
          </label>
          <p className="text-sm text-muted-foreground">{t('settings.soundHelp')}</p>
        </section>
      </DialogContent>
    </Dialog>
  )
}
