import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Layers,
  CreditCard,
  Brain,
  ShoppingBag,
  Sparkles,
  Check,
  Loader2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOnboardingStore } from '../../stores/onboarding-store'
import { useTemplateStore } from '../../stores/template-store'
import { getSampleDeck, getSampleCards } from '../../lib/onboarding-samples'

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
    <div className="flex flex-col items-center text-center px-4 sm:px-8 py-6 w-full">
      <div className="w-20 h-20 rounded-full bg-indigo-100 flex items-center justify-center mb-6">
        {icon}
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-3">{title}</h2>
      <p className="text-muted-foreground mb-8 max-w-sm leading-relaxed">{description}</p>
      {children}
    </div>
  )
}

// ─── Step 1: Welcome ───────────────────────────────────────

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
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors cursor-pointer"
      >
        {t('onboarding.welcome.action')}
      </button>
    </StepLayout>
  )
}

// ─── Step 2: Create Deck ───────────────────────────────────

export function CreateDeckStep({ onNext }: StepProps) {
  const { t, i18n } = useTranslation('common')
  const setSampleDeckId = useOnboardingStore((s) => s.setSampleDeckId)
  const [status, setStatus] = useState<'idle' | 'creating' | 'created'>('idle')

  const locale = i18n.language.split('-')[0]
  const sample = getSampleDeck(locale)

  const handleCreate = async () => {
    setStatus('creating')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('decks')
        .insert({
          user_id: user.id,
          name: sample.name,
          description: sample.description,
          color: '#3B82F6',
          icon: 'book-open',
        })
        .select('id')
        .single()

      if (error) throw error
      setSampleDeckId(data.id)
      setStatus('created')

      // Auto-advance after a brief pause
      setTimeout(() => onNext(), 600)
    } catch {
      setStatus('idle')
    }
  }

  return (
    <StepLayout
      icon={<BookOpen className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.createDeck.title')}
      description={t('onboarding.createDeck.description')}
    >
      {/* Deck preview card */}
      <div className="w-full max-w-sm bg-muted border border-border rounded-xl p-5 mb-6 text-left">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-brand flex items-center justify-center text-white text-lg">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate">{sample.name}</p>
            <p className="text-sm text-muted-foreground truncate">{sample.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 text-xs text-content-tertiary">
          <span className="inline-block w-3 h-3 rounded-full bg-brand" />
          <span>#3B82F6</span>
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={status !== 'idle'}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
      >
        {status === 'creating' && <Loader2 className="w-4 h-4 animate-spin" />}
        {status === 'created' && <Check className="w-4 h-4" />}
        {status === 'idle' && t('onboarding.createDeck.action')}
        {status === 'creating' && t('onboarding.createDeck.creating')}
        {status === 'created' && t('onboarding.createDeck.created')}
      </button>
    </StepLayout>
  )
}

// ─── Step 3: Card Template ─────────────────────────────────

export function CardTemplateStep({ onNext }: StepProps) {
  const { t } = useTranslation('common')
  const { templates, fetchTemplates } = useTemplateStore()
  const setSampleTemplateId = useOnboardingStore((s) => s.setSampleTemplateId)
  const [loaded, setLoaded] = useState(false)

  // Fetch templates on first render if not already loaded
  if (!loaded && templates.length === 0) {
    setLoaded(true)
    fetchTemplates()
  }

  const handleSelectTemplate = (id: string) => {
    setSampleTemplateId(id)
    onNext()
  }

  // Show default templates (or first 3 available)
  const displayTemplates = templates.slice(0, 3)

  return (
    <StepLayout
      icon={<Layers className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.cardTemplate.title')}
      description={t('onboarding.cardTemplate.description')}
    >
      {/* Template list */}
      <div className="w-full max-w-sm space-y-2 mb-6">
        {displayTemplates.map((tmpl) => (
          <button
            key={tmpl.id}
            onClick={() => handleSelectTemplate(tmpl.id)}
            className="w-full flex items-center gap-3 p-3 bg-muted border border-border rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-success/15 flex items-center justify-center text-success shrink-0">
              <Check className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground text-sm truncate">{tmpl.name}</p>
              <p className="text-xs text-muted-foreground">
                {tmpl.fields.length} {t('onboarding.cardTemplate.fields', { count: tmpl.fields.length })}
              </p>
            </div>
          </button>
        ))}
        {displayTemplates.length === 0 && (
          <div className="text-center py-4 text-content-tertiary text-sm">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            {t('status.loading')}
          </div>
        )}
      </div>

      <button
        onClick={onNext}
        className="w-full sm:w-auto px-8 py-3 border-2 border-indigo-600 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-50 transition-colors cursor-pointer"
      >
        {t('onboarding.next')}
      </button>
    </StepLayout>
  )
}

// ─── Step 4: Add Cards ─────────────────────────────────────

export function AddCardsStep({ onNext }: StepProps) {
  const { t, i18n } = useTranslation('common')
  const sampleDeckId = useOnboardingStore((s) => s.sampleDeckId)
  const sampleTemplateId = useOnboardingStore((s) => s.sampleTemplateId)
  const [status, setStatus] = useState<'idle' | 'adding' | 'added'>('idle')

  const locale = i18n.language.split('-')[0]
  const sampleCards = getSampleCards(locale)

  const handleAddCards = async () => {
    if (!sampleDeckId) {
      onNext()
      return
    }

    setStatus('adding')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const rows = sampleCards.map((card, idx) => ({
        deck_id: sampleDeckId,
        user_id: user.id,
        template_id: sampleTemplateId,
        field_values: { front: card.word, back: card.meaning },
        tags: [] as string[],
        sort_position: idx,
        srs_status: 'new',
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
      }))

      const { error } = await supabase.from('cards').insert(rows)
      if (error) throw error

      // Update deck next_position
      await supabase
        .from('decks')
        .update({ next_position: sampleCards.length })
        .eq('id', sampleDeckId)

      setStatus('added')
      setTimeout(() => onNext(), 600)
    } catch {
      setStatus('idle')
    }
  }

  return (
    <StepLayout
      icon={<CreditCard className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.addCards.title')}
      description={t('onboarding.addCards.description')}
    >
      {/* Sample cards preview */}
      <div className="w-full max-w-sm space-y-2 mb-6">
        {sampleCards.map((card, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 bg-muted border border-border rounded-xl"
          >
            <span className="text-lg">🃏</span>
            <span className="font-medium text-foreground text-sm">{card.word}</span>
            <span className="text-content-tertiary text-sm">&rarr;</span>
            <span className="text-muted-foreground text-sm">{card.meaning}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
        <button
          onClick={handleAddCards}
          disabled={status !== 'idle'}
          className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
        >
          {status === 'adding' && <Loader2 className="w-4 h-4 animate-spin" />}
          {status === 'added' && <Check className="w-4 h-4" />}
          {status === 'idle' && t('onboarding.addCards.action')}
          {status === 'adding' && t('onboarding.addCards.adding')}
          {status === 'added' && t('onboarding.addCards.added')}
        </button>
        <button
          onClick={onNext}
          className="w-full sm:w-auto px-8 py-3 border-2 border-indigo-600 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-50 transition-colors cursor-pointer"
        >
          {t('onboarding.skip')}
        </button>
      </div>
    </StepLayout>
  )
}

// ─── Step 5: First Study ───────────────────────────────────

export function FirstStudyStep({ onAction }: StepProps) {
  const { t, i18n } = useTranslation('common')
  const sampleDeckId = useOnboardingStore((s) => s.sampleDeckId)

  const locale = i18n.language.split('-')[0]
  const sample = getSampleDeck(locale)
  const sampleCards = getSampleCards(locale)

  return (
    <StepLayout
      icon={<Brain className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.firstStudy.title')}
      description={t('onboarding.firstStudy.description', {
        deckName: sample.name,
        cardCount: sampleCards.length,
      })}
    >
      {/* Study modes preview */}
      <div className="w-full max-w-sm bg-muted border border-border rounded-xl p-4 mb-6 text-left space-y-2">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span className="text-warning">&#11088;</span>
          <span className="font-medium">SRS (Spaced Repetition)</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span className="text-content-tertiary">&#8226;</span>
          <span>Random Review</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span className="text-content-tertiary">&#8226;</span>
          <span>Sequential</span>
        </div>
      </div>

      <button
        onClick={() => {
          if (sampleDeckId) {
            onAction(`navigate:/decks/${sampleDeckId}/study/setup`)
          } else {
            onAction('navigate:/quick-study')
          }
        }}
        className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors cursor-pointer"
      >
        {t('onboarding.firstStudy.action')}
      </button>
    </StepLayout>
  )
}

// ─── Step 6: Explore Marketplace ───────────────────────────

export function ExploreMarketStep({ onAction }: StepProps) {
  const { t } = useTranslation('common')
  return (
    <StepLayout
      icon={<ShoppingBag className="w-10 h-10 text-indigo-600" />}
      title={t('onboarding.exploreMarket.title')}
      description={t('onboarding.exploreMarket.description')}
    >
      <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
        <button
          onClick={() => onAction('navigate:/marketplace')}
          className="w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors cursor-pointer"
        >
          {t('onboarding.exploreMarket.action')}
        </button>
        <button
          onClick={() => onAction('finish')}
          className="w-full sm:w-auto px-8 py-3 border-2 border-indigo-600 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-50 transition-colors cursor-pointer"
        >
          {t('onboarding.exploreMarket.actionFinish')}
        </button>
      </div>
    </StepLayout>
  )
}
