import { Sun, Moon, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThemePreference } from '../../hooks/useTheme'

interface ThemeToggleProps {
  theme: ThemePreference
  onChange: (theme: ThemePreference) => void
}

const OPTIONS: { value: ThemePreference; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon, labelKey: 'theme.dark' },
  { value: 'system', icon: Monitor, labelKey: 'theme.system' },
]

/**
 * Three-way theme toggle: Light / Dark / System.
 *
 * Renders a segmented control with icons and labels.
 * Designed for use inside the Settings page.
 */
export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  const { t } = useTranslation('settings')

  return (
    <div
      className="inline-flex rounded-xl p-1"
      style={{
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
      }}
      role="radiogroup"
      aria-label={t('theme.title')}
    >
      {OPTIONS.map(({ value, icon: Icon, labelKey }) => {
        const isActive = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(value)}
            className={`
              flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium
              transition-all duration-200 cursor-pointer
              ${isActive
                ? 'bg-card text-foreground shadow-sm dark:bg-slate-700'
                : 'text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-200'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t(labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
