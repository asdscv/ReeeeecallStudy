import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, X } from 'lucide-react'
import {
  ONBOARDING_STEPS,
  useOnboardingStore,
} from '../../stores/onboarding-store'
import type { OnboardingStepKey } from '../../stores/onboarding-store'
import {
  WelcomeStep,
  CreateDeckStep,
  CardTemplateStep,
  AddCardsStep,
  FirstStudyStep,
  ExploreMarketStep,
} from './OnboardingSteps'

const STEP_COMPONENTS = [
  WelcomeStep,
  CreateDeckStep,
  CardTemplateStep,
  AddCardsStep,
  FirstStudyStep,
  ExploreMarketStep,
] as const

export function OnboardingOverlay() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const {
    currentStep,
    nextStep,
    prevStep,
    skip,
    completeStep,
    dismiss,
  } = useOnboardingStore()

  const totalSteps = ONBOARDING_STEPS.length
  const stepDef = ONBOARDING_STEPS[currentStep]
  const StepComponent = STEP_COMPONENTS[currentStep]
  const isFirst = currentStep === 0

  // Lock body scroll while overlay is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const handleAction = useCallback(
    (action: string) => {
      // Mark current step as complete
      completeStep(stepDef.key as OnboardingStepKey)

      if (action === 'finish') {
        dismiss()
        return
      }

      if (action.startsWith('navigate:')) {
        const path = action.replace('navigate:', '')
        dismiss()
        navigate(path)
        return
      }
    },
    [completeStep, stepDef.key, dismiss, navigate],
  )

  const handleNext = useCallback(() => {
    completeStep(stepDef.key as OnboardingStepKey)
    nextStep()
  }, [completeStep, stepDef.key, nextStep])

  const progressPercent = ((currentStep + 1) / totalSteps) * 100

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      data-testid="onboarding-overlay"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative w-full max-w-lg mx-4 bg-card rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Progress bar */}
        <div className="h-1 bg-accent">
          <div
            className="h-full bg-indigo-600 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Top bar: back + step counter + skip */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={prevStep}
            disabled={isFirst}
            className={`flex items-center gap-1 text-sm font-medium transition-colors ${
              isFirst
                ? 'text-transparent cursor-default'
                : 'text-muted-foreground hover:text-foreground cursor-pointer'
            }`}
            aria-label={t('onboarding.back')}
          >
            <ChevronLeft className="w-4 h-4" />
            {t('onboarding.back')}
          </button>

          <span className="text-xs text-content-tertiary font-medium">
            {t('onboarding.stepOf', { current: currentStep + 1, total: totalSteps })}
          </span>

          <button
            onClick={skip}
            className="flex items-center gap-1 text-sm text-content-tertiary hover:text-muted-foreground transition-colors cursor-pointer"
            data-testid="onboarding-skip"
          >
            {t('onboarding.skip')}
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step content */}
        <div className="min-h-[320px] flex items-center justify-center">
          <StepComponent onNext={handleNext} onAction={handleAction} />
        </div>

        {/* Step indicator dots */}
        <div className="flex items-center justify-center gap-2 pb-6" data-testid="step-dots">
          {ONBOARDING_STEPS.map((step, i) => (
            <div
              key={step.key}
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                i === currentStep
                  ? 'bg-indigo-600 scale-125'
                  : i < currentStep
                    ? 'bg-indigo-300'
                    : 'bg-accent'
              }`}
              data-testid={`step-dot-${i}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
