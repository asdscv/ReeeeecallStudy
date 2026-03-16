import { useTranslation } from 'react-i18next'

interface AdminErrorStateProps {
  error: string
  onRetry?: () => void
}

export function AdminErrorState({ error, onRetry }: AdminErrorStateProps) {
  const { t } = useTranslation('admin')

  return (
    <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
      <p className="text-sm text-red-600 mb-3">{error}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition cursor-pointer"
        >
          {t('retry', 'Retry')}
        </button>
      )}
    </div>
  )
}
