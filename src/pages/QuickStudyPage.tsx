import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth-store'
import { useDeckStore } from '../stores/deck-store'
import { supabase } from '../lib/supabase'
import { utcToLocalDateKey, localDateToUTCRange, todayDateKey } from '../lib/date-utils'
import { DatePicker } from '../components/study/DatePicker'
import {
  STUDY_MODE_OPTIONS,
  DEFAULT_BATCH_SIZE,
  MIN_BATCH_SIZE,
  MAX_BATCH_SIZE,
  isBatchSizeConfigurable,
  clampBatchSize,
} from '../lib/study-session-utils'
import type { Deck, StudyMode } from '../types/database'

export function QuickStudyPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { decks, stats, loading, fetchDecks, fetchStats } = useDeckStore()

  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null)
  const [selectedMode, setSelectedMode] = useState<StudyMode | null>(null)
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE)

  // by_date state
  const [selectedDate, setSelectedDate] = useState(() => todayDateKey())
  const [datesWithCards, setDatesWithCards] = useState<Set<string>>(new Set())
  const [dateCardCount, setDateCardCount] = useState(0)

  useEffect(() => {
    fetchDecks()
    if (user) fetchStats(user.id)
  }, [fetchDecks, fetchStats, user])

  // Fetch dates with cards when by_date is selected
  useEffect(() => {
    if (!selectedDeck || selectedMode !== 'by_date') return
    const load = async () => {
      const { data: cardDates } = await supabase
        .from('cards')
        .select('created_at')
        .eq('deck_id', selectedDeck.id)
        .neq('srs_status', 'suspended')
      if (cardDates) {
        const dates = new Set<string>()
        cardDates.forEach((c: { created_at: string }) => {
          dates.add(utcToLocalDateKey(c.created_at))
        })
        setDatesWithCards(dates)
      }
    }
    load()
  }, [selectedDeck, selectedMode])

  // Update date card count when selected date changes
  useEffect(() => {
    if (!selectedDeck || selectedMode !== 'by_date' || !selectedDate) return
    const fetchCount = async () => {
      const { start: dateStart, end: dateEnd } = localDateToUTCRange(selectedDate)
      const { count } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('deck_id', selectedDeck.id)
        .neq('srs_status', 'suspended')
        .gte('created_at', dateStart)
        .lte('created_at', dateEnd)
      setDateCardCount(count ?? 0)
    }
    fetchCount()
  }, [selectedDeck, selectedMode, selectedDate])

  const getStatsForDeck = (deckId: string) => {
    return stats.find((s) => s.deck_id === deckId)
  }

  const closeModal = () => {
    setSelectedDeck(null)
    setSelectedMode(null)
    setBatchSize(DEFAULT_BATCH_SIZE)
    setSelectedDate(todayDateKey())
    setDatesWithCards(new Set())
    setDateCardCount(0)
  }

  const handleModeSelect = (mode: StudyMode) => {
    if (!selectedDeck) return

    // by_date — show date picker step in modal
    if (mode === 'by_date') {
      setSelectedMode(mode)
      return
    }

    // If batch size is configurable, show the config step
    if (isBatchSizeConfigurable(mode)) {
      setSelectedMode(mode)
      return
    }

    // Non-configurable modes (srs) — start immediately
    navigate(`/decks/${selectedDeck.id}/study?mode=${mode}&batchSize=${DEFAULT_BATCH_SIZE}`)
  }

  const handleStartStudy = () => {
    if (!selectedDeck || !selectedMode) return

    const params = new URLSearchParams({
      mode: selectedMode,
      batchSize: String(clampBatchSize(batchSize)),
    })

    if (selectedMode === 'by_date' && selectedDate) {
      const { start, end } = localDateToUTCRange(selectedDate)
      params.set('dateStart', start)
      params.set('dateEnd', end)
    }

    navigate(`/decks/${selectedDeck.id}/study?${params.toString()}`)
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">
        <span className="mr-2">⚡</span>빠른 학습
      </h1>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="text-4xl animate-pulse">📚</div>
        </div>
      ) : decks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-gray-500">덱이 없습니다. 먼저 덱을 만들어주세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4">
          {decks.map((deck) => {
            const deckStats = getStatsForDeck(deck.id)
            return (
              <button
                key={deck.id}
                onClick={() => setSelectedDeck(deck)}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden text-left hover:shadow-md transition cursor-pointer"
              >
                <div
                  className="h-1.5 sm:h-2"
                  style={{ backgroundColor: deck.color || '#3B82F6' }}
                />
                <div className="p-3 sm:p-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                    <span className="text-xl sm:text-2xl shrink-0">{deck.icon || '📚'}</span>
                    <span className="text-sm sm:text-base font-semibold text-gray-900 truncate">
                      {deck.name}
                    </span>
                  </div>
                  <div className="text-xs sm:text-sm text-gray-500 mb-1.5 sm:mb-2">
                    {deckStats?.total_cards ?? 0}장
                  </div>
                  <div className="flex flex-wrap gap-1 sm:gap-2">
                    {(deckStats?.new_cards ?? 0) > 0 && (
                      <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-100 text-blue-700">
                        새 {deckStats!.new_cards}
                      </span>
                    )}
                    {(deckStats?.review_cards ?? 0) > 0 && (
                      <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-orange-100 text-orange-700">
                        복습 {deckStats!.review_cards}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Study Mode Selection Modal */}
      {selectedDeck && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm sm:max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 border-b border-gray-100">
              <h2 className="text-base sm:text-lg font-bold text-gray-900">
                {selectedDeck.icon} {selectedDeck.name}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {selectedMode === 'by_date'
                  ? '학습할 날짜를 선택하세요'
                  : selectedMode
                    ? '배치 크기를 설정하세요'
                    : '학습 모드를 선택하세요'}
              </p>
            </div>

            {!selectedMode ? (
              /* Step 1: Mode selection */
              <div className="p-3 space-y-1">
                {STUDY_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleModeSelect(opt.value)}
                    className="w-full text-left px-4 py-3 rounded-xl hover:bg-gray-50 transition flex items-start gap-3 cursor-pointer"
                  >
                    <span className="text-xl">{opt.emoji}</span>
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{opt.label}</div>
                      <div className="text-xs text-gray-500">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : selectedMode === 'by_date' ? (
              /* Step 2a: Date picker for by_date mode */
              <div className="p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4 text-sm text-gray-600">
                  <span className="text-lg">
                    {STUDY_MODE_OPTIONS.find(o => o.value === selectedMode)?.emoji}
                  </span>
                  {STUDY_MODE_OPTIONS.find(o => o.value === selectedMode)?.label}
                </div>
                <DatePicker
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  datesWithCards={datesWithCards}
                />
                <div className="mt-2 text-sm font-medium text-blue-600">
                  {selectedDate && (() => {
                    const [year, month, day] = selectedDate.split('-').map(Number)
                    return `${year}년 ${month}월 ${day}일`
                  })()} 업로드: {dateCardCount}장
                </div>
                <button
                  onClick={handleStartStudy}
                  disabled={dateCardCount === 0}
                  className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium rounded-xl transition cursor-pointer disabled:cursor-not-allowed"
                >
                  학습 시작
                </button>
              </div>
            ) : (
              /* Step 2b: Batch size configuration */
              <div className="p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-4 text-sm text-gray-600">
                  <span className="text-lg">
                    {STUDY_MODE_OPTIONS.find(o => o.value === selectedMode)?.emoji}
                  </span>
                  {STUDY_MODE_OPTIONS.find(o => o.value === selectedMode)?.label}
                </div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  배치 크기
                </label>
                <input
                  type="number"
                  min={MIN_BATCH_SIZE}
                  max={MAX_BATCH_SIZE}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value) || DEFAULT_BATCH_SIZE)}
                  className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  한 세션에 학습할 카드 수 ({MIN_BATCH_SIZE}~{MAX_BATCH_SIZE})
                </p>
                <button
                  onClick={handleStartStudy}
                  className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition cursor-pointer"
                >
                  학습 시작
                </button>
              </div>
            )}

            <div className="p-3 border-t border-gray-100">
              <button
                onClick={selectedMode ? () => setSelectedMode(null) : closeModal}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                {selectedMode ? '← 모드 선택으로' : '취소'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
