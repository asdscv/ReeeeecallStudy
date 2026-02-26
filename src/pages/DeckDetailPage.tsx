import { useEffect, useRef, useState } from 'react'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../lib/locale-utils'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pencil, Trash2, Settings, Share2, Upload, Download, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isPast, formatLocalDate } from '../lib/date-utils'
import { getPageSelectAllState, togglePageSelectAll } from '../lib/card-selection'
import { useCardStore } from '../stores/card-store'
import { CardFormModal } from '../components/card/CardFormModal'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { ImportModal } from '../components/import-export/ImportModal'
import { ExportModal } from '../components/import-export/ExportModal'
import { UploadDateTab } from '../components/deck/UploadDateTab'
import { DeckStatsTab } from '../components/deck/DeckStatsTab'
import type { Deck, Card, CardTemplate } from '../types/database'

type TabId = 'cards' | 'upload-date' | 'stats'

export function DeckDetailPage() {
  const { t, i18n } = useTranslation(['decks', 'common'])
  const dateLocale = toIntlLocale(i18n.language)
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()

  const { cards, loading: cardsLoading, fetchCards } = useCardStore()

  const [deck, setDeck] = useState<Deck | null>(null)
  const [template, setTemplate] = useState<CardTemplate | null>(null)
  const [loading, setLoading] = useState(true)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('cards')

  // Card form state
  const [showCardForm, setShowCardForm] = useState(false)
  const [editingCard, setEditingCard] = useState<Card | null>(null)

  // Delete state
  const [deletingCard, setDeletingCard] = useState<Card | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)

  // Filter
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Import/Export
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [cardsPerPage, setCardsPerPage] = useState(20)

  // Refs (Rules of Hooks: must be before any early return)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectAllMobileRef = useRef<HTMLInputElement>(null)

  // --- Derived values (safe even when loading — cards defaults to []) ---
  const newCount = cards.filter((c) => c.srs_status === 'new').length
  const reviewCount = cards.filter(
    (c) => c.srs_status === 'review' && c.next_review_at && isPast(c.next_review_at)
  ).length
  const learningCount = cards.filter(
    (c) => c.srs_status === 'learning' && c.next_review_at && isPast(c.next_review_at)
  ).length
  const displayFields = template?.fields ?? []

  const filteredCards = cards.filter((card) => {
    if (statusFilter !== 'all' && card.srs_status !== statusFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matchesField = Object.values(card.field_values).some((v) =>
        v.toLowerCase().includes(q)
      )
      const matchesTag = card.tags.some((t) => t.toLowerCase().includes(q))
      if (!matchesField && !matchesTag) return false
    }
    return true
  })

  const totalPages = Math.ceil(filteredCards.length / cardsPerPage)
  const safePage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1
  const startIdx = (safePage - 1) * cardsPerPage
  const endIdx = startIdx + cardsPerPage
  const paginatedCards = filteredCards.slice(startIdx, endIdx)

  const pageCardIds = paginatedCards.map((c) => c.id)
  const selectAllState = getPageSelectAllState(selectedIds, pageCardIds)
  const validCardIdSet = new Set(cards.map((c) => c.id))
  const validSelectedCount = Array.from(selectedIds).filter((id) => validCardIdSet.has(id)).length

  // --- All useEffects (must be before early returns) ---
  useEffect(() => {
    if (!deckId) return
    const fetchData = async () => {
      setLoading(true)
      const { data: deckData } = await supabase
        .from('decks')
        .select('*')
        .eq('id', deckId)
        .single()

      const typedDeck = deckData as Deck | null
      if (!typedDeck) {
        navigate('/decks', { replace: true })
        return
      }
      setDeck(typedDeck)

      if (typedDeck.default_template_id) {
        const { data: tmpl } = await supabase
          .from('card_templates')
          .select('*')
          .eq('id', typedDeck.default_template_id)
          .single()
        setTemplate(tmpl as CardTemplate | null)
      }

      await fetchCards(deckId)
      setLoading(false)
    }
    fetchData()
  }, [deckId, navigate, fetchCards])

  // 삭제 후 currentPage가 totalPages를 초과할 때 자동 보정
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [totalPages, currentPage])

  // indeterminate 체크박스 DOM 동기화
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectAllState === 'some'
    }
    if (selectAllMobileRef.current) {
      selectAllMobileRef.current.indeterminate = selectAllState === 'some'
    }
  }, [selectAllState])

  // --- Early returns (all hooks above, safe) ---
  if (loading || cardsLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📚</div>
      </div>
    )
  }

  if (!deck) return null

  // --- Event handlers (not hooks) ---
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const toggleSelectAll = () => {
    setSelectedIds(togglePageSelectAll(selectedIds, pageCardIds))
  }

  const handleDeleteCard = async () => {
    if (!deletingCard) return
    setDeleteLoading(true)
    const { deleteCard } = useCardStore.getState()
    await deleteCard(deletingCard.id)
    // 삭제된 카드를 selectedIds에서도 제거
    setSelectedIds((prev) => {
      if (!prev.has(deletingCard.id)) return prev
      const next = new Set(prev)
      next.delete(deletingCard.id)
      return next
    })
    setDeleteLoading(false)
    setDeletingCard(null)
  }

  const handleBulkDelete = async () => {
    setDeleteLoading(true)
    const { deleteCards } = useCardStore.getState()
    // validCardIdSet은 상위 스코프에서 계산됨 — stale ID 방어
    const idsToDelete = Array.from(selectedIds).filter((id) => validCardIdSet.has(id))
    if (idsToDelete.length > 0) {
      await deleteCards(idsToDelete)
    }
    setDeleteLoading(false)
    setShowBulkDelete(false)
    setSelectedIds(new Set())
  }

  const handleEditCard = (card: Card) => {
    setEditingCard(card)
    setShowCardForm(true)
  }

  const handleCloseForm = () => {
    setShowCardForm(false)
    setEditingCard(null)
  }

  const handleImportComplete = () => {
    // createCards already calls fetchCards internally, no need to refetch
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'cards', label: t('decks:detail.tabs.cardList') },
    { id: 'upload-date', label: t('decks:detail.tabs.uploadDate') },
    { id: 'stats', label: t('decks:detail.tabs.statistics') },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <button
          onClick={() => navigate('/decks')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 cursor-pointer"
        >
          {t('decks:detail.backToList')}
        </button>
        <div className="flex items-center gap-2 sm:gap-3 mb-2">
          <span className="text-2xl sm:text-3xl">{deck.icon}</span>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{deck.name}</h1>
        </div>
        {deck.description && (
          <p className="text-sm sm:text-base text-gray-500">{deck.description}</p>
        )}

        {/* Stats badges */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3">
          <span className="px-2.5 sm:px-3 py-1 text-xs sm:text-sm bg-gray-100 text-gray-700 rounded-full">
            {t('decks:detail.totalCards', { count: cards.length })}
          </span>
          {newCount > 0 && (
            <span className="px-2.5 sm:px-3 py-1 text-xs sm:text-sm bg-blue-50 text-blue-700 rounded-full">
              {t('decks:detail.newCards', { count: newCount })}
            </span>
          )}
          {(reviewCount + learningCount) > 0 && (
            <span className="px-2.5 sm:px-3 py-1 text-xs sm:text-sm bg-amber-50 text-amber-700 rounded-full">
              {t('decks:detail.reviewCards', { count: reviewCount + learningCount })}
            </span>
          )}
        </div>

        {/* Action buttons — scroll horizontally on mobile */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4">
          <button
            onClick={() => navigate(`/decks/${deckId}/study/setup`)}
            className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            {t('decks:detail.startStudy')}
          </button>
          {!deck.is_readonly && (
            <button
              onClick={() => navigate(`/decks/${deckId}/edit`)}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              {t('decks:detail.edit')}
            </button>
          )}
          <button
            onClick={() => navigate(`/decks/${deckId}/share`)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            {t('decks:detail.share')}
          </button>
          {!deck.is_readonly && (
            <button
              onClick={() => { setEditingCard(null); setShowCardForm(true) }}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {t('decks:detail.addCard')}
            </button>
          )}
          {!deck.is_readonly && (
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              {t('decks:detail.import')}
            </button>
          )}
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            {t('decks:detail.export')}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'cards' && (
        <>
          {/* Search & Filter bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); setSelectedIds(new Set()) }}
              placeholder={t('decks:detail.searchPlaceholder')}
              className="flex-1 px-3 sm:px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-gray-900"
            />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); setSelectedIds(new Set()) }}
              className="px-3 py-2.5 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none"
            >
              <option value="all">{t('decks:detail.allStatus')}</option>
              <option value="new">{t('common:status.new')}</option>
              <option value="learning">{t('common:status.learning')}</option>
              <option value="review">{t('common:status.review')}</option>
              <option value="suspended">{t('common:status.suspended')}</option>
            </select>
            <select
              value={cardsPerPage}
              onChange={(e) => {
                setCardsPerPage(Number(e.target.value))
                setCurrentPage(1)
                setSelectedIds(new Set())
              }}
              className="px-3 py-2.5 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none"
            >
              {[10, 20, 30, 50, 100].map((n) => (
                <option key={n} value={n}>{t('decks:detail.perPage', { count: n })}</option>
              ))}
            </select>
          </div>

          {/* Bulk action bar */}
          {validSelectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 p-3 bg-blue-50 rounded-lg">
              <span className="text-sm text-blue-700 font-medium">
                {t('decks:detail.selectedCount', { count: validSelectedCount })}
              </span>
              <button
                onClick={() => setShowBulkDelete(true)}
                className="px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 cursor-pointer"
              >
                {t('common:delete')}
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
              >
                {t('common:deselect')}
              </button>
            </div>
          )}

          {/* Card list */}
          {cards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 sm:p-12 text-center">
              <div className="text-4xl sm:text-5xl mb-4">🃏</div>
              <p className="text-gray-500 mb-4">{t('decks:detail.noCards')}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3">
                <button
                  onClick={() => { setEditingCard(null); setShowCardForm(true) }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
                >
                  {t('decks:detail.addFirstCard')}
                </button>
                {!deck.is_readonly && (
                  <button
                    onClick={() => setShowImport(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    {t('decks:detail.importCards')}
                  </button>
                )}
                <button
                  onClick={() => setShowExport(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  {t('decks:detail.downloadTemplate')}
                </button>
              </div>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
              {t('decks:detail.noSearchResults')}
            </div>
          ) : (
            <>
              {/* Desktop table (hidden on mobile) */}
              <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-3 w-10">
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          checked={selectAllState === 'all'}
                          onChange={toggleSelectAll}
                          className="cursor-pointer"
                        />
                      </th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-10">
                        {t('decks:detail.columns.number')}
                      </th>
                      {displayFields.map((field) => (
                        <th
                          key={field.key}
                          className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3"
                        >
                          {field.name}
                        </th>
                      ))}
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-24">
                        {t('decks:detail.columns.status')}
                      </th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-28">
                        {t('decks:detail.columns.addedDate')}
                      </th>
                      <th className="px-4 py-3 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedCards.map((card, i) => (
                      <tr
                        key={card.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(card.id)}
                            onChange={() => toggleSelect(card.id)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">{startIdx + i + 1}</td>
                        {displayFields.map((field) => (
                          <td
                            key={field.key}
                            className="px-4 py-3 text-sm text-gray-900 cursor-pointer max-w-[200px]"
                            onClick={() => handleEditCard(card)}
                          >
                            <div className="truncate">
                              {card.field_values[field.key] || '-'}
                            </div>
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          <StatusBadge status={card.srs_status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {formatLocalDate(card.created_at, dateLocale)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEditCard(card)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition cursor-pointer"
                              title={t('common:edit')}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeletingCard(card)}
                              className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition cursor-pointer"
                              title={t('common:delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card view (hidden on desktop) */}
              <div className="md:hidden space-y-2">
                {/* Select all */}
                <div className="flex items-center gap-2 px-3 mb-2">
                  <input
                    ref={selectAllMobileRef}
                    type="checkbox"
                    checked={selectAllState === 'all'}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                  />
                  <span className="text-xs text-gray-500">{t('common:selectAllPage')}</span>
                </div>
                {paginatedCards.map((card, i) => (
                  <div
                    key={card.id}
                    className="bg-white rounded-xl border border-gray-200 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(card.id)}
                        onChange={() => toggleSelect(card.id)}
                        className="cursor-pointer mt-1 shrink-0"
                      />
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => handleEditCard(card)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-400">#{startIdx + i + 1}</span>
                          <StatusBadge status={card.srs_status} />
                        </div>
                        {displayFields.slice(0, 3).map((field) => (
                          <p key={field.key} className="text-sm text-gray-900 truncate">
                            <span className="text-xs text-gray-400 mr-1">{field.name}:</span>
                            {card.field_values[field.key] || '-'}
                          </p>
                        ))}
                        <p className="text-xs text-gray-400 mt-1">
                          {formatLocalDate(card.created_at, dateLocale)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleEditCard(card)}
                          className="p-3 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingCard(card)}
                          className="p-3 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 sm:px-4 py-3 mt-3 bg-white rounded-xl border border-gray-200">
                  <span className="text-xs sm:text-sm text-gray-500">
                    {startIdx + 1}~{Math.min(endIdx, filteredCards.length)} / {t('decks:detail.totalCards', { count: filteredCards.length })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                      disabled={safePage <= 1}
                      className="p-2.5 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let page: number
                      if (totalPages <= 5) {
                        page = i + 1
                      } else if (safePage <= 3) {
                        page = i + 1
                      } else if (safePage >= totalPages - 2) {
                        page = totalPages - 4 + i
                      } else {
                        page = safePage - 2 + i
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-10 h-10 text-sm rounded cursor-pointer ${
                            safePage === page
                              ? 'bg-blue-600 text-white'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                      disabled={safePage >= totalPages}
                      className="p-2.5 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeTab === 'upload-date' && (
        <UploadDateTab
          cards={cards}
          template={template}
          onEditCard={handleEditCard}
        />
      )}

      {activeTab === 'stats' && (
        <DeckStatsTab
          deckId={deckId!}
          cards={cards}
        />
      )}

      {/* Card Form Modal */}
      <CardFormModal
        open={showCardForm}
        onClose={handleCloseForm}
        deckId={deckId!}
        template={template}
        editCard={editingCard}
      />

      {/* Import Modal */}
      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        deckId={deckId!}
        templateId={deck.default_template_id ?? ''}
        template={template}
        onComplete={handleImportComplete}
      />

      {/* Export Modal */}
      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        deck={deck}
        template={template}
        cards={cards}
      />

      {/* Single Delete Confirm */}
      <ConfirmDialog
        open={!!deletingCard}
        onClose={() => setDeletingCard(null)}
        onConfirm={handleDeleteCard}
        title={t('decks:detail.deleteCard')}
        message={t('decks:detail.deleteCardConfirm')}
        confirmLabel={t('common:delete')}
        danger
        loading={deleteLoading}
      />

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title={t('decks:detail.bulkDelete')}
        message={t('decks:detail.bulkDeleteConfirm', { count: validSelectedCount })}
        confirmLabel={t('common:delete')}
        danger
        loading={deleteLoading}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: 'bg-blue-50 text-blue-700',
    learning: 'bg-amber-50 text-amber-700',
    review: 'bg-green-50 text-green-700',
    suspended: 'bg-gray-100 text-gray-500',
  }
  const className = styles[status] ?? styles.new
  const label = i18next.t(`common:status.${status}`, { defaultValue: status })
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${className}`}>
      {label}
    </span>
  )
}
