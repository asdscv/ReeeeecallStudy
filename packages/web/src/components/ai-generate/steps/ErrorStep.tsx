import { useTranslation } from 'react-i18next'
import { AlertTriangle, RotateCcw, ArrowLeft } from 'lucide-react'

interface ErrorStepProps {
  error: string
  onRetry: () => void
  onBack: () => void
}

export function ErrorStep({ error, onRetry, onBack }: ErrorStepProps) {
  const { t } = useTranslation('ai-generate')

  return (
    <div className="text-center space-y-5">
      <div className="flex justify-center">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-500" />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-gray-900">{t('errors.title')}</h3>
        <p className="text-sm text-gray-500 mt-1">{t('errors.description')}</p>
      </div>

      <div className="text-left text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-4 font-mono break-all">
        {error}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('errors.back')}
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          {t('errors.retry')}
        </button>
      </div>
    </div>
  )
}
