import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Layers,
  CreditCard,
  Brain,
  ShoppingBag,
  Sparkles,
} from 'lucide-react'

export interface StepProps {
  onNext: () => void
  onAction: (action: string) => void
}

function StepLayout({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center px-4 sm:px-8 py-6">
      <div className="w-20 h-20 rounded-full bg-indigo-100 flex items-center justify-center mb-6">
        {icon}
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-3">{title}</h2>
      <p className="text-gray-600 mb-8 max-w-sm leading-relaxed">{description}</p>
      <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
        {children}
      </div>
    </div>
  )
}

export function WelcomeStep({ onNext }: StepProps) {
  const { t } = useTranslation('common')
  return (
    <StepLayout
      icon={<Sparkles className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.welcome.title')}
      description={t('onboarding.welcome.description')}
    >
      <button
        onClick={onNext}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
      >
        {t('onboarding.welcome.action')}
      </button>
    </StepLayout>
  )
}

export function CreateDeckStep({ onAction }: StepProps) {
  const { t } = useTranslation('common')
  return (
    <StepLayout
      icon={<BookOpen className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.createDeck.title')}
      description={t('onboarding.createDeck.description')}
    >
      <button
        onClick={() => onAction('navigate:/decks')}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
      >
        {t('onboarding.createDeck.action')}
      </button>
    </StepLayout>
  )
}

export function CardTemplateStep({ onAction }: StepProps) {
  const { t } = useTranslation('common')
  return (
    <StepLayout
      icon={<Layers className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.cardTemplate.title')}
      description={t('onboarding.cardTemplate.description')}
    >
      <button
        onClick={() => onAction('navigate:/templates')}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
      >
        {t('onboarding.cardTemplate.action')}
      </button>
    </StepLayout>
  )
}

export function AddCardsStep({ onAction }: StepProps) {
  const { t } = useTranslation('common')
  return (
    <StepLayout
      icon={<CreditCard className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.addCards.title')}
      description={t('onboarding.addCards.description')}
    >
      <button
        onClick={() => onAction('navigate:/decks')}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
      >
        {t('onboarding.addCards.action')}
      </button>
      <button
        onClick={() => onAction('navigate:/ai-generate')}
        className="w-full sm:w-auto px-8 py-3 border-2 border-indigo-600 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-50 transition-colors"
      >
        {t('onboarding.addCards.actionAlt')}
      </button>
    </StepLayout>
  )
}

export function FirstStudyStep({ onAction }: StepProps) {
  const { t } = useTranslation('common')
  return (
    <StepLayout
      icon={<Brain className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.firstStudy.title')}
      description={t('onboarding.firstStudy.description')}
    >
      <button
        onClick={() => onAction('navigate:/study')}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
      >
        {t('onboarding.firstStudy.action')}
      </button>
    </StepLayout>
  )
}

export function ExploreMarketStep({ onAction }: StepProps) {
  const { t } = useTranslation('common')
  return (
    <StepLayout
      icon={<ShoppingBag className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.exploreMarket.title')}
      description={t('onboarding.exploreMarket.description')}
    >
      <button
        onClick={() => onAction('navigate:/marketplace')}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
      >
        {t('onboarding.exploreMarket.action')}
      </button>
      <button
        onClick={() => onAction('finish')}
        className="w-full sm:w-auto px-8 py-3 border-2 border-indigo-600 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-50 transition-colors"
      >
        {t('onboarding.exploreMarket.actionFinish')}
      </button>
    </StepLayout>
  )
}
