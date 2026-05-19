import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { useSharingStore } from '../stores/sharing-store'
import { supabase } from '../lib/supabase'
import { DeckCard } from '../components/deck/DeckCard'
import { DeckFormModal } from '../components/deck/DeckFormModal'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { AIGenerateModal } from '../components/ai-generate/AIGenerateModal'
import { GuideHelpLink } from '../components/common/GuideHelpLink'
import type { Deck } from '../types/database'

export function DecksPage() {
  const { t } = useTranslation(['decks', 'common', 'marketplace', 'sharing'])
  const { user } = useAuthStore()
  const { decks, stats, templates, loading, fetchDecks, fetchStats, fetchTemplates, deleteDeck } = useDeckStore()

  const [showCreate, setShowCreate] = useState(false)
  const [showAIGenerate, setShowAIGenerate] = useState(false)
  const [deletingDeck, setDeletingDeck] = useState<Deck | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [unsubscribingDeck, setUnsubscribingDeck] = useState<Deck | null>(null)
  const [unsubscribeLoading, setUnsubscribeLoading] = useState(false)
  const [unsubscribeError, setUnsubscribeError] = useState<string | null>(null)

  useEffect(() => {
    fetchDecks()
    fetchTemplates()
    if (user) fetchStats(user.id)
  }, [fetchDecks, fetchStats, fetchTemplates, user])

  const handleDelete = async () => {
    if (!deletingDeck) return
    setDeleteLoading(true)
    await deleteDeck(deletingDeck.id)
    setDeleteLoading(false)
    setDeletingDeck(null)
  }

  const handleUnsubscribeConfirm = async () => {
    if (!unsubscribingDeck || !user) return
    setUnsubscribeLoading(true)
    setUnsubscribeError(null)
    try {
      // Look up the active subscribe share for this deck so we can revoke it.
      const { data: shareRow, error: shareErr } = await supabase
        .from('deck_shares')
        .select('id')
        .eq('deck_id', unsubscribingDeck.id)
        .eq('recipient_id', user.id)
        .eq('share_mode', 'subscribe')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()

      if (shareErr || !shareRow) {
        setUnsubscribeError(
          shareErr?.message ??
            t('marketplace:detail.unsubscribeError', { defaultValue: 'Failed to unsubscribe.' }),
        )
        return
      }

      await useSharingStore.getState().unsubscribe((shareRow as { id: string }).id)
      const storeError = useSharingStore.getState().error
      if (storeError) {
        setUnsubscribeError(storeError)
        return
      }

      await fetchDecks({ force: true })
      setUnsubscribingDeck(null)
    } finally {
      setUnsubscribeLoading(false)
    }
  }

  const getStatsForDeck = (deckId: string) => {
    return stats.find((s) => s.deck_id === deckId)
  }

  const getTemplateName = (templateId: string | null) => {
    if (!templateId) return undefined
    return templates.find((t) => t.id === templateId)?.name
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('decks:title')}</h1>
          <GuideHelpLink section="decks" />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAIGenerate(true)}
            className="px-3 sm:px-4 py-2 bg-purple-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-purple-700 transition cursor-pointer"
          >
            {t('ai-generate:button.aiGenerate')}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 sm:px-4 py-2 bg-brand text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-brand transition cursor-pointer"
          >
            {t('decks:createNew')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="text-4xl animate-pulse">📚</div>
        </div>
      ) : decks.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 sm:p-12 text-center">
          <div className="text-4xl sm:text-5xl mb-4">📚</div>
          <p className="text-muted-foreground mb-4 text-sm sm:text-base">{t('decks:empty')}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition cursor-pointer"
          >
            {t('decks:createFirst')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              stats={getStatsForDeck(deck.id)}
              templateName={getTemplateName(deck.default_template_id)}
              onDelete={setDeletingDeck}
              onUnsubscribe={setUnsubscribingDeck}
            />
          ))}
        </div>
      )}

      {/* AI Generate Modal */}
      <AIGenerateModal
        open={showAIGenerate}
        onClose={() => { setShowAIGenerate(false); fetchDecks(); if (user) fetchStats(user.id) }}
        initialMode="full"
      />

      {/* Create Modal */}
      <DeckFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deletingDeck}
        onClose={() => setDeletingDeck(null)}
        onConfirm={handleDelete}
        title={t('decks:deleteDeck')}
        message={t('decks:deleteConfirm', { name: deletingDeck?.name })}
        confirmLabel={t('common:actions.delete')}
        danger
        loading={deleteLoading}
      />

      {/* Unsubscribe Confirm */}
      <ConfirmDialog
        open={!!unsubscribingDeck}
        onClose={() => { setUnsubscribingDeck(null); setUnsubscribeError(null) }}
        onConfirm={handleUnsubscribeConfirm}
        title={t('sharing:unsubscribe', { defaultValue: 'Unsubscribe' })}
        message={
          unsubscribeError
            ? `${t('marketplace:detail.unsubscribeError', { defaultValue: 'Failed to unsubscribe.' })} (${unsubscribeError})`
            : t('marketplace:detail.unsubscribeConfirm', {
                defaultValue:
                  'Unsubscribe from this deck? Your personal study progress for it will remain in your account.',
              })
        }
        confirmLabel={t('sharing:unsubscribe', { defaultValue: 'Unsubscribe' })}
        danger
        loading={unsubscribeLoading}
      />
    </div>
  )
}
