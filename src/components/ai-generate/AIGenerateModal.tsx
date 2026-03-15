import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { useAIGenerateStore } from '../../stores/ai-generate-store'
import { useTemplateStore } from '../../stores/template-store'
import { ConfigStep } from './steps/ConfigStep'
import { GeneratingStep } from './steps/GeneratingStep'
import { ReviewTemplateStep } from './steps/ReviewTemplateStep'
import { ReviewDeckStep } from './steps/ReviewDeckStep'
import { ReviewCardsStep } from './steps/ReviewCardsStep'
import { DoneStep } from './steps/DoneStep'
import { ErrorStep } from './steps/ErrorStep'
import type { GenerateMode, GeneratedTemplateField } from '../../lib/ai/types'
import type { GenerateConfig } from './steps/ConfigStep'

interface AIGenerateModalProps {
  open: boolean
  onClose: () => void
  initialMode: GenerateMode
  existingTemplateId?: string | null
  existingDeckId?: string | null
}

export function AIGenerateModal({
  open,
  onClose,
  initialMode,
  existingTemplateId,
  existingDeckId,
}: AIGenerateModalProps) {
  const { t } = useTranslation('ai-generate')
  const store = useAIGenerateStore()

  // Reset on open
  useEffect(() => {
    if (open) {
      store.reset()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = (cfg: GenerateConfig) => {
    const currentMode = useAIGenerateStore.getState().mode || initialMode

    // For cards_only, use the deck selected in config (or prop)
    const deckId = cfg.selectedDeckId || existingDeckId || null
    const templateId = cfg.selectedTemplateId || existingTemplateId || null

    store.setConfig({
      mode: currentMode,
      topic: cfg.topic,
      cardCount: cfg.cardCount,
      useCustomHtml: cfg.useCustomHtml,
      contentLang: cfg.contentLang,
      fieldHints: cfg.customFields,
      existingTemplateId: templateId,
      existingDeckId: deckId,
    })

    if (currentMode === 'full') {
      store.generateTemplate()
    } else {
      // cards_only — go straight to cards
      store.generateCards()
    }
  }

  const handleModeChange = (mode: GenerateMode) => {
    store.setConfig({
      mode,
      topic: store.topic,
      cardCount: store.cardCount,
      useCustomHtml: store.useCustomHtml,
      existingTemplateId: existingTemplateId ?? null,
      existingDeckId: existingDeckId ?? null,
    })
  }

  const handleAddMore = () => {
    const deckId = store.createdDeckId || store.existingDeckId || existingDeckId
    const templateId = store.createdTemplateId || store.existingTemplateId || existingTemplateId
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

  const handleRetry = () => {
    store.reset()
  }

  const handleTemplateNext = () => {
    const mode = useAIGenerateStore.getState().mode
    if (mode === 'full') {
      store.generateDeck()
    } else {
      store.generateCards()
    }
  }

  const handleDeckNext = () => {
    store.generateCards()
  }

  const getStepTitle = (): string => {
    switch (store.currentStep) {
      case 'config': return t('title')
      case 'generating_template':
      case 'generating_deck':
      case 'generating_cards':
      case 'saving':
        return t('steps.generating')
      case 'review_template': return t('review.templateTitle')
      case 'review_deck': return t('review.deckTitle')
      case 'review_cards': return t('review.cardsReviewTitle')
      case 'done': return t('done.title')
      case 'error': return t('errors.title')
      default: return t('title')
    }
  }

  const getFields = (): GeneratedTemplateField[] => {
    if (store.generatedTemplate) return store.generatedTemplate.fields

    const templateId = store.existingTemplateId || existingTemplateId
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{getStepTitle()}</DialogTitle>
        </DialogHeader>

        {store.currentStep === 'config' && (
          <ConfigStep
            mode={store.mode || initialMode}
            initialTopic={store.topic}
            existingDeckId={store.existingDeckId || existingDeckId}
            onStart={handleStart}
            showModeSelect={initialMode === 'full'}
            onModeChange={handleModeChange}
          />
        )}

        {(store.currentStep === 'generating_template' ||
          store.currentStep === 'generating_deck' ||
          store.currentStep === 'generating_cards' ||
          store.currentStep === 'saving') && (
          <GeneratingStep step={store.currentStep} progress={store.progress} />
        )}

        {store.currentStep === 'review_template' && store.generatedTemplate && (
          <ReviewTemplateStep
            template={store.generatedTemplate}
            onChange={store.editGeneratedTemplate}
            onRegenerate={() => store.generateTemplate()}
            onNext={handleTemplateNext}
          />
        )}

        {store.currentStep === 'review_deck' && store.generatedDeck && (
          <ReviewDeckStep
            deck={store.generatedDeck}
            onChange={store.editGeneratedDeck}
            onRegenerate={() => store.generateDeck()}
            onNext={handleDeckNext}
          />
        )}

        {store.currentStep === 'review_cards' && store.generatedCards && (
          <ReviewCardsStep
            cards={store.generatedCards}
            fields={getFields()}
            filteredCount={store.filteredCardCount}
            onChange={store.editGeneratedCards}
            onRemove={store.removeGeneratedCard}
            onSave={() => store.saveAll()}
          />
        )}

        {store.currentStep === 'done' && (
          <DoneStep
            templateName={store.generatedTemplate?.name}
            deckName={store.generatedDeck?.name}
            cardCount={store.generatedCards?.length ?? 0}
            deckId={store.createdDeckId || store.existingDeckId || existingDeckId || null}
            templateId={store.createdTemplateId || store.existingTemplateId || existingTemplateId || null}
            onAddMore={handleAddMore}
            onClose={onClose}
          />
        )}

        {store.currentStep === 'error' && store.error && (
          <ErrorStep
            error={store.error}
            onRetry={handleRetry}
            onBack={() => { store.reset() }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
