import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/auth-store'
import { toast } from 'sonner'

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type DayKey = (typeof ALL_DAYS)[number]

async function autoSaveProfile(
  userId: string,
  field: string,
  value: unknown,
): Promise<boolean> {
  const { error } = await supabase
    .from('profiles')
    .update({ [field]: value } as Record<string, unknown>)
    .eq('id', userId)
  return !error
}

export function ReminderSettings() {
  const { t } = useTranslation('settings')
  const { user } = useAuthStore()

  const [enabled, setEnabled] = useState(false)
  const [hour, setHour] = useState(9)
  const [days, setDays] = useState<DayKey[]>(['mon', 'tue', 'wed', 'thu', 'fri'])
  const [loaded, setLoaded] = useState(false)

  // Load from profile
  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('reminder_enabled, reminder_hour, reminder_days')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setEnabled(data.reminder_enabled ?? false)
          setHour(data.reminder_hour ?? 9)
          setDays((data.reminder_days as DayKey[]) ?? ['mon', 'tue', 'wed', 'thu', 'fri'])
        }
        setLoaded(true)
      })
  }, [user])

  const save = useCallback(
    async (field: string, value: unknown) => {
      if (!user) return
      const ok = await autoSaveProfile(user.id, field, value)
      if (ok) toast.success(t('autoSaved', 'Saved'))
    },
    [user, t],
  )

  const toggleEnabled = useCallback(
    async (val: boolean) => {
      setEnabled(val)
      await save('reminder_enabled', val)
    },
    [save],
  )

  const changeHour = useCallback(
    async (val: number) => {
      setHour(val)
      await save('reminder_hour', val)
    },
    [save],
  )

  const toggleDay = useCallback(
    async (day: DayKey) => {
      const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
      // Keep at least one day
      if (next.length === 0) return
      setDays(next)
      await save('reminder_days', next)
    },
    [days, save],
  )

  const formatTime = (h: number) => {
    const suffix = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:00 ${suffix}`
  }

  if (!loaded) return null

  return (
    <section className="bg-card rounded-xl border border-border p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="w-5 h-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">
          {t('reminders.title', 'Study Reminders')}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t('reminders.description', 'Get reminded to study daily, just like Duolingo.')}
      </p>

      {/* Toggle */}
      <label className="flex items-center gap-3 cursor-pointer mb-4">
        <div className="relative">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-6 bg-accent peer-focus:ring-2 peer-focus:ring-brand/20 rounded-full peer peer-checked:bg-brand transition-colors" />
          <div className="absolute top-0.5 left-0.5 w-5 h-5 bg-card rounded-full shadow peer-checked:translate-x-4 transition-transform" />
        </div>
        <span className="text-sm text-foreground">
          {t('reminders.enable', 'Enable reminders')}
        </span>
      </label>

      {enabled && (
        <div className="space-y-4">
          {/* Time picker */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('reminders.time', 'Reminder time')}
            </label>
            <select
              value={hour}
              onChange={(e) => changeHour(parseInt(e.target.value, 10))}
              className="w-40 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {formatTime(i)}
                </option>
              ))}
            </select>
          </div>

          {/* Day selector */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('reminders.days', 'Reminder days')}
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition cursor-pointer ${
                    days.includes(day)
                      ? 'bg-brand text-white'
                      : 'bg-accent text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {t(`reminders.${day}`, day.charAt(0).toUpperCase() + day.slice(1))}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <p className="text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
            {t('reminders.preview', 'You\'ll receive reminders at {{time}} on {{days}}', {
              time: formatTime(hour),
              days: days.map((d) => t(`reminders.${d}`, d)).join(', '),
            })}
          </p>
        </div>
      )}
    </section>
  )
}
