import { useTranslation } from 'react-i18next'
import type { GenerateStep } from '../../../lib/ai/types'

interface GeneratingStepProps {
  step: GenerateStep
  progress: { done: number; total: number }
}

const STEP_ORDER: GenerateStep[] = ['generating_template', 'generating_deck', 'generating_cards', 'saving']

export function GeneratingStep({ step, progress }: GeneratingStepProps) {
  const { t } = useTranslation('ai-generate')

  const stepLabels: Partial<Record<GenerateStep, string>> = {
    generating_template: t('steps.generatingTemplate'),
    generating_deck: t('steps.generatingDeck'),
    generating_cards: t('steps.generatingCards'),
    saving: t('steps.saving'),
  }

  const label = stepLabels[step] || t('steps.generatingCards')
  const showProgress = (step === 'generating_cards' || step === 'saving') && progress.total > 0
  const pct = showProgress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="flex flex-col items-center justify-center py-8 gap-6">
      {/* Animated icon */}
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
          <span className="text-3xl animate-bounce" style={{ animationDuration: '1.5s' }}>
            {step === 'saving' ? '💾' : step === 'generating_template' ? '📋' : step === 'generating_deck' ? '📚' : '🤖'}
          </span>
        </div>
        {/* Spinning ring */}
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
      </div>

      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="text-xs text-gray-400">{t('steps.pleaseWait')}</p>
      </div>

      {/* Sub-step indicators */}
      <div className="flex items-center gap-2">
        {STEP_ORDER.map((s) => {
          const isCurrent = s === step
          const isDone = STEP_ORDER.indexOf(s) < STEP_ORDER.indexOf(step)
          // Only show steps that are relevant
          if (s === 'generating_template' && step !== 'generating_template' && !isDone) return null
          if (s === 'generating_deck' && step !== 'generating_deck' && !isDone) return null
          return (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                isDone ? 'bg-green-400' : isCurrent ? 'bg-blue-500 scale-125' : 'bg-gray-200'
              }`}
            />
          )
        })}
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div className="w-full max-w-xs space-y-1">
          <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-full h-2 transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>{progress.done} / {progress.total}</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
