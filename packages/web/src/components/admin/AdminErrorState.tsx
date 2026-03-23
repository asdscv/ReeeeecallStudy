import { useTranslation } from 'react-i18next'

interface AdminErrorStateProps {
  error: string
  onRetry?: () => void
}

export function AdminErrorState({ error, onRetry }: AdminErrorStateProps) {
  const { t } = useTranslation('admin')

  return (
    <div role="alert" className="bg-destructive/10 border border-destructive/30 rounded-xl p-6 text-center">
      <p className="text-sm text-destructive mb-3">{error}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-sm bg-destructive text-white rounded-lg hover:bg-destructive transition cursor-pointer"
        >
          {t('retry', 'Retry')}
        </button>
      )}
    </div>
  )
}
