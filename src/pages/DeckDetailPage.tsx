import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
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

  if (loading || cardsLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📚</div>
      </div>
    )
  }

  if (!deck) return null

  // Stats
  const newCount = cards.filter((c) => c.srs_status === 'new').length
  const reviewCount = cards.filter(
    (c) => c.srs_status === 'review' && c.next_review_at && new Date(c.next_review_at) <= new Date()
  ).length
  const learningCount = cards.filter(
    (c) => c.srs_status === 'learning' && c.next_review_at && new Date(c.next_review_at) <= new Date()
  ).length

  // Template fields for table headers
  const displayFields = template?.fields.slice(0, 3) ?? []

  // Filtered cards
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

  // Pagination
  const totalPages = Math.ceil(filteredCards.length / cardsPerPage)
  const startIdx = (currentPage - 1) * cardsPerPage
  const endIdx = startIdx + cardsPerPage
  const paginatedCards = filteredCards.slice(startIdx, endIdx)

  // Selection handlers
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCards.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredCards.map((c) => c.id)))
    }
  }

  const handleDeleteCard = async () => {
    if (!deletingCard) return
    setDeleteLoading(true)
    const { deleteCard } = useCardStore.getState()
    await deleteCard(deletingCard.id)
    setDeleteLoading(false)
    setDeletingCard(null)
  }

  const handleBulkDelete = async () => {
    setDeleteLoading(true)
    const { deleteCards } = useCardStore.getState()
    await deleteCards(Array.from(selectedIds))
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
    if (deckId) fetchCards(deckId)
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'cards', label: '카드 목록' },
    { id: 'upload-date', label: '업로드 일자' },
    { id: 'stats', label: '통계' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/decks')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 cursor-pointer"
        >
          ← 덱 목록
        </button>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">{deck.icon}</span>
          <h1 className="text-2xl font-bold text-gray-900">{deck.name}</h1>
        </div>
        {deck.description && (
          <p className="text-gray-500">{deck.description}</p>
        )}

        {/* Stats badges */}
        <div className="flex items-center gap-3 mt-3">
          <span className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full">
            전체 {cards.length}장
          </span>
          {newCount > 0 && (
            <span className="px-3 py-1 text-sm bg-blue-50 text-blue-700 rounded-full">
              새 카드 {newCount}
            </span>
          )}
          {(reviewCount + learningCount) > 0 && (
            <span className="px-3 py-1 text-sm bg-amber-50 text-amber-700 rounded-full">
              복습 예정 {reviewCount + learningCount}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => navigate(`/decks/${deckId}/study/setup`)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            학습 시작
          </button>
          <button
            onClick={() => { setEditingCard(null); setShowCardForm(true) }}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
          >
            + 카드 추가
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
          >
            가져오기
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
          >
            내보내기
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition cursor-pointer ${
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
          <div className="flex items-center gap-3 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
              placeholder="카드 검색..."
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-gray-900"
            />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1) }}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none"
            >
              <option value="all">전체 상태</option>
              <option value="new">New</option>
              <option value="learning">Learning</option>
              <option value="review">Review</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-lg">
              <span className="text-sm text-blue-700 font-medium">
                {selectedIds.size}개 선택됨
              </span>
              <button
                onClick={() => setShowBulkDelete(true)}
                className="px-3 py-1 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 cursor-pointer"
              >
                선택 삭제
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
              >
                선택 해제
              </button>
            </div>
          )}

          {/* Card list table */}
          {cards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="text-5xl mb-4">🃏</div>
              <p className="text-gray-500 mb-4">카드가 없습니다. 카드를 추가해보세요.</p>
              <button
                onClick={() => { setEditingCard(null); setShowCardForm(true) }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
              >
                + 첫 번째 카드 추가
              </button>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
              검색 결과가 없습니다.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filteredCards.length && filteredCards.length > 0}
                        onChange={toggleSelectAll}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-10">
                      #
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
                      상태
                    </th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3 w-28">
                      추가일
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
                          className="px-4 py-3 text-sm text-gray-900 cursor-pointer"
                          onClick={() => handleEditCard(card)}
                        >
                          {card.field_values[field.key] || '-'}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <StatusBadge status={card.srs_status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {new Date(card.created_at).toLocaleDateString('ko-KR')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleEditCard(card)}
                            className="text-xs text-gray-500 hover:text-blue-600 px-2 py-1 cursor-pointer"
                          >
                            편집
                          </button>
                          <button
                            onClick={() => setDeletingCard(card)}
                            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 cursor-pointer"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">
                      {startIdx + 1}~{Math.min(endIdx, filteredCards.length)} / 총 {filteredCards.length}장
                    </span>
                    <select
                      value={cardsPerPage}
                      onChange={(e) => {
                        setCardsPerPage(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      className="text-sm border border-gray-300 rounded px-2 py-1 outline-none"
                    >
                      {[10, 20, 30, 50, 100].map((n) => (
                        <option key={n} value={n}>{n}개씩</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage <= 1}
                      className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let page: number
                      if (totalPages <= 7) {
                        page = i + 1
                      } else if (currentPage <= 4) {
                        page = i + 1
                      } else if (currentPage >= totalPages - 3) {
                        page = totalPages - 6 + i
                      } else {
                        page = currentPage - 3 + i
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-8 h-8 text-sm rounded cursor-pointer ${
                            currentPage === page
                              ? 'bg-blue-600 text-white'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage >= totalPages}
                      className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
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
        title="카드 삭제"
        message="이 카드를 삭제하시겠습니까? 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
        loading={deleteLoading}
      />

      {/* Bulk Delete Confirm */}
      <ConfirmDialog
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title="카드 일괄 삭제"
        message={`선택한 ${selectedIds.size}개의 카드를 삭제하시겠습니까? 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
        danger
        loading={deleteLoading}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    new: { label: 'New', className: 'bg-blue-50 text-blue-700' },
    learning: { label: 'Learning', className: 'bg-amber-50 text-amber-700' },
    review: { label: 'Review', className: 'bg-green-50 text-green-700' },
    suspended: { label: 'Suspended', className: 'bg-gray-100 text-gray-500' },
  }
  const c = config[status] ?? config.new
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${c.className}`}>
      {c.label}
    </span>
  )
}
