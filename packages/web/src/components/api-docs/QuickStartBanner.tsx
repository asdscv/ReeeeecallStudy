import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export type QuickStartVariant = 'public' | 'authenticated'

export function QuickStartBanner({ variant }: { variant: QuickStartVariant }) {
  const { t } = useTranslation('api-docs')
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 sm:p-5 mb-4 sm:mb-6">
      <h2 className="text-sm font-semibold text-blue-900 mb-2">{t('quickStart.title')}</h2>
      <div className="space-y-2 text-xs sm:text-sm text-blue-800">
        {variant === 'authenticated' ? (
          <p>1. <Link to="/settings" className="underline font-medium">{t('quickStart.settingsPage')}</Link>{t('quickStart.step1Auth')}</p>
        ) : (
          <p>1. <Link to="/auth/login" className="underline font-medium">{t('quickStart.signup')}</Link> {t('quickStart.step1Public')}</p>
        )}
        <p>2. {t('quickStart.step2')} <code className="bg-blue-100 px-1.5 py-0.5 rounded text-blue-900 font-mono text-xs">Authorization: Bearer rc_...</code> {t('quickStart.step2Suffix')}</p>
        <p>3. {t('quickStart.step3')}</p>
      </div>
    </div>
  )
}
