import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export function useLocale() {
  const { i18n } = useTranslation()

  const changeLanguage = useCallback(
    async (lng: string) => {
      await i18n.changeLanguage(lng)
      localStorage.setItem('reeeeecall-lang', lng)
      document.documentElement.lang = lng
    },
    [i18n],
  )

  const formatDate = useCallback(
    (date: Date | string, options?: Intl.DateTimeFormatOptions) => {
      const d = typeof date === 'string' ? new Date(date) : date
      const locale = i18n.language === 'ko' ? 'ko-KR' : 'en-US'
      return d.toLocaleDateString(locale, options)
    },
    [i18n.language],
  )

  const formatNumber = useCallback(
    (num: number, options?: Intl.NumberFormatOptions) => {
      const locale = i18n.language === 'ko' ? 'ko-KR' : 'en-US'
      return new Intl.NumberFormat(locale, options).format(num)
    },
    [i18n.language],
  )

  const formatRelativeTime = useCallback(
    (date: Date | string) => {
      const d = typeof date === 'string' ? new Date(date) : date
      const now = Date.now()
      const diffMs = now - d.getTime()
      const diffMin = Math.floor(diffMs / 60_000)

      const locale = i18n.language === 'ko' ? 'ko-KR' : 'en-US'
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

      if (diffMin < 1) return rtf.format(0, 'second')
      if (diffMin < 60) return rtf.format(-diffMin, 'minute')

      const diffHour = Math.floor(diffMin / 60)
      if (diffHour < 24) return rtf.format(-diffHour, 'hour')

      const diffDay = Math.floor(diffHour / 24)
      if (diffDay < 30) return rtf.format(-diffDay, 'day')

      return d.toLocaleDateString(locale)
    },
    [i18n.language],
  )

  return {
    language: i18n.language,
    changeLanguage,
    formatDate,
    formatNumber,
    formatRelativeTime,
  }
}
