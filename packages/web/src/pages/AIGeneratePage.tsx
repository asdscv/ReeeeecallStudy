import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAIGenerateStore } from '../stores/ai-generate-store'
import { useTemplateStore } from '../stores/template-store'
import { aiKeyVault } from '../lib/ai/secure-storage'
import { ConfigStep } from '../components/ai-generate/steps/ConfigStep'
import { GeneratingStep } from '../components/ai-generate/steps/GeneratingStep'
import { ReviewTemplateStep } from '../components/ai-generate/steps/ReviewTemplateStep'
import { ReviewDeckStep } from '../components/ai-generate/steps/ReviewDeckStep'
import { ReviewCardsStep } from '../components/ai-generate/steps/ReviewCardsStep'
import { DoneStep } from '../components/ai-generate/steps/DoneStep'
import { ErrorStep } from '../components/ai-generate/steps/ErrorStep'
import type { GenerateMode, GeneratedTemplateField } from '../lib/ai/types'
import { GuideHelpLink } from '../components/common/GuideHelpLink'
import type { GenerateConfig } from '../components/ai-generate/steps/ConfigStep'

// ─── Step definitions for the wizard ───────────────────────

interface WizardStep {
  key: string
  labelKey: string
}

const FULL_STEPS: WizardStep[] = [
  { key: 'config', labelKey: 'wizard.setup' },
  { key: 'template', labelKey: 'wizard.template' },
  { key: 'deck', labelKey: 'wizard.deck' },
  { key: 'cards', labelKey: 'wizard.cards' },
  { key: 'done', labelKey: 'wizard.done' },
]

const CARDS_ONLY_STEPS: WizardStep[] = [
  { key: 'config', labelKey: 'wizard.setup' },
  { key: 'cards', labelKey: 'wizard.cards' },
  { key: 'done', labelKey: 'wizard.done' },
]

function mapStoreStepToWizardKey(step: string): string {
  if (step === 'config') return 'config'
  if (step.includes('template')) return 'template'
  if (step.includes('deck')) return 'deck'
  if (step.includes('card') || step === 'saving') return 'cards'
  if (step === 'done') return 'done'
  if (step === 'error') return 'cards' // show error at the cards step position
  return 'config'
}

// ─── Page Component ────────────────────────────────────────

export function AIGeneratePage() {
  const { t } = useTranslation('ai-generate')
  const [searchParams] = useSearchParams()
  const store = useAIGenerateStore()

  const paramMode = searchParams.get('mode') as GenerateMode | null
  const paramDeckId = searchParams.get('deckId')
  const paramTemplateId = searchParams.get('templateId')
  const initialMode: GenerateMode = paramMode === 'cards_only' ? 'cards_only' : 'full'

  const hasApiKey = aiKeyVault.hasAnyKey()

  // Reset store on mount
  useEffect(() => {
    store.reset()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const currentMode = store.mode || initialMode
  const wizardSteps = currentMode === 'full' ? FULL_STEPS : CARDS_ONLY_STEPS
  const currentWizardKey = mapStoreStepToWizardKey(store.currentStep)
  const currentStepIndex = wizardSteps.findIndex((s) => s.key === currentWizardKey)

  // ── Handlers ──

  const handleStart = (cfg: GenerateConfig) => {
    const mode = useAIGenerateStore.getState().mode || initialMode
    const deckId = cfg.selectedDeckId || paramDeckId || null
    const templateId = cfg.selectedTemplateId || paramTemplateId || null

    store.setConfig({
      mode,
      topic: cfg.topic,
      cardCount: cfg.cardCount,
      useCustomHtml: cfg.useCustomHtml,
      contentLang: cfg.contentLang,
      fieldHints: cfg.customFields,
      existingTemplateId: templateId,
      existingDeckId: deckId,
    })

    if (mode === 'full') {
      store.generateTemplate()
    } else {
      store.generateCards()
    }
  }

  const handleModeChange = (mode: GenerateMode) => {
    store.setConfig({
      mode,
      topic: store.topic,
      cardCount: store.cardCount,
      useCustomHtml: store.useCustomHtml,
      existingTemplateId: paramTemplateId ?? null,
      existingDeckId: paramDeckId ?? null,
    })
  }

  const handleTemplateNext = () => {
    const mode = useAIGenerateStore.getState().mode
    if (mode === 'full') store.generateDeck()
    else store.generateCards()
  }

  const handleDeckNext = () => store.generateCards()

  const handleAddMore = () => {
    const deckId = store.createdDeckId || store.existingDeckId || paramDeckId
    const templateId = store.createdTemplateId || store.existingTemplateId || paramTemplateId
    const prevTopic = store.topic
    store.reset()
    store.setConfig({
      mode: 'cards_only',
      topic: prevTopic,
      cardCount: 20,
      useCustomHtml: false,
      existingTemplateId: templateId,
      existingDeckId: deckId,
    })
  }

  const handleReset = () => store.reset()

  const getFields = useMemo((): (() => GeneratedTemplateField[]) => {
    return () => {
      if (store.generatedTemplate) return store.generatedTemplate.fields
      const templateId = store.existingTemplateId || paramTemplateId
      if (templateId) {
        const templates = useTemplateStore.getState().templates
        const tmpl = templates.find((t) => t.id === templateId)
        if (tmpl) {
          return tmpl.fields
            .filter((f) => f.type === 'text')
            .map((f) => ({ ...f, type: 'text' as const }))
        }
      }
      return []
    }
  }, [store.generatedTemplate, store.existingTemplateId, paramTemplateId])

  const isGenerating =
    store.currentStep === 'generating_template' ||
    store.currentStep === 'generating_deck' ||
    store.currentStep === 'generating_cards' ||
    store.currentStep === 'saving'

  return (
    <div className="max-w-3xl mx-auto">
      {/* ── Header ── */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('page.title')}</h1>
          <GuideHelpLink section="ai-generate" />
        </div>
        <p className="text-sm text-muted-foreground mt-1">{t('page.subtitle')}</p>
      </div>

      {/* ── Wizard Stepper ── */}
      <div className="mb-6">
        <div className="flex items-center">
          {wizardSteps.map((step, i) => {
            const isActive = i === currentStepIndex
            const isComplete = i < currentStepIndex
            const isLast = i === wizardSteps.length - 1
            return (
              <div key={step.key} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                      isComplete
                        ? 'bg-success text-white'
                        : isActive
                          ? 'bg-brand text-white ring-4 ring-blue-100'
                          : 'bg-accent text-muted-foreground'
                    }`}
                  >
                    {isComplete ? '✓' : i + 1}
                  </div>
                  <span
                    className={`text-[10px] sm:text-xs mt-1 whitespace-nowrap ${
                      isActive ? 'text-brand font-semibold' : 'text-content-tertiary'
                    }`}
                  >
                    {t(step.labelKey)}
                  </span>
                </div>
                {!isLast && (
                  <div
                    className={`flex-1 h-0.5 mx-2 mt-[-16px] transition-all duration-500 ${
                      isComplete ? 'bg-success' : 'bg-accent'
                    }`}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Step Content ── */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {/* Config Step */}
        {store.currentStep === 'config' && (
          <div className="p-5 sm:p-6">
            {/* Quick start hint if API key exists */}
            {hasApiKey && (
              <div className="mb-4 px-3 py-2 bg-success/10 border border-success/30 rounded-lg text-xs text-success flex items-center gap-2">
                <span>✓</span>
                {t('page.apiKeySaved')}
              </div>
            )}
            <ConfigStep
              mode={currentMode}
              initialTopic={store.topic}
              existingDeckId={store.existingDeckId || paramDeckId}
              onStart={handleStart}
              showModeSelect
              onModeChange={handleModeChange}
            />
          </div>
        )}

        {/* Generating Steps */}
        {isGenerating && (
          <div className="p-8 sm:p-12">
            <GeneratingStep step={store.currentStep} progress={store.progress} />
          </div>
        )}

        {/* Review Template */}
        {store.currentStep === 'review_template' && store.generatedTemplate && (
          <div className="p-5 sm:p-6">
            <ReviewTemplateStep
              template={store.generatedTemplate}
              onChange={store.editGeneratedTemplate}
              onRegenerate={() => store.generateTemplate()}
              onNext={handleTemplateNext}
            />
          </div>
        )}

        {/* Review Deck */}
        {store.currentStep === 'review_deck' && store.generatedDeck && (
          <div className="p-5 sm:p-6">
            <ReviewDeckStep
              deck={store.generatedDeck}
              onChange={store.editGeneratedDeck}
              onRegenerate={() => store.generateDeck()}
              onNext={handleDeckNext}
            />
          </div>
        )}

        {/* Review Cards */}
        {store.currentStep === 'review_cards' && store.generatedCards && (
          <div className="p-5 sm:p-6">
            <ReviewCardsStep
              cards={store.generatedCards}
              fields={getFields()}
              filteredCount={store.filteredCardCount}
              onChange={store.editGeneratedCards}
              onRemove={store.removeGeneratedCard}
              onSave={() => store.saveAll()}
            />
          </div>
        )}

        {/* Done */}
        {store.currentStep === 'done' && (
          <div className="p-5 sm:p-8">
            <DoneStep
              templateName={store.generatedTemplate?.name}
              deckName={store.generatedDeck?.name}
              cardCount={store.generatedCards?.length ?? 0}
              deckId={store.createdDeckId || store.existingDeckId || paramDeckId || null}
              templateId={store.createdTemplateId || store.existingTemplateId || paramTemplateId || null}
              onAddMore={handleAddMore}
              onClose={handleReset}
            />
          </div>
        )}

        {/* Error */}
        {store.currentStep === 'error' && store.error && (
          <div className="p-5 sm:p-8">
            <ErrorStep
              error={store.error}
              onRetry={handleReset}
              onBack={handleReset}
            />
          </div>
        )}
      </div>

      {/* ── Bottom info (only on config step) ── */}
      {store.currentStep === 'config' && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoCard icon="🔒" title={t('page.securityTitle')} desc={t('page.securityDesc')} />
          <InfoCard icon="🌍" title={t('page.languageTitle')} desc={t('page.languageDesc')} />
          <InfoCard icon="⚡" title={t('page.speedTitle')} desc={t('page.speedDesc')} />
        </div>
      )}
    </div>
  )
}

function InfoCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3 p-3 bg-card rounded-xl border border-border">
      <span className="text-lg shrink-0">{icon}</span>
      <div>
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="text-[10px] text-content-tertiary mt-0.5">{desc}</p>
      </div>
    </div>
  )
}
