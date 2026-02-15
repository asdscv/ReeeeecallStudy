import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { utcToLocalDateKey, localDateToUTCRange, todayDateKey } from '../lib/date-utils'
import { DatePicker } from '../components/study/DatePicker'
import type { Deck, StudyMode } from '../types/database'

const modeOptions: { value: StudyMode; emoji: string; label: string; desc: string }[] = [
  { value: 'srs', emoji: '🧠', label: 'SRS (간격 반복)', desc: '복습 시기에 따라 자동으로 카드를 선별합니다' },
  { value: 'sequential_review', emoji: '🔄', label: '순차 복습', desc: '새 카드와 복습 카드를 순서대로 학습합니다' },
  { value: 'random', emoji: '🎲', label: '랜덤', desc: '카드를 무작위로 섞어 학습합니다' },
  { value: 'sequential', emoji: '➡️', label: '순차', desc: '카드를 순서대로 학습합니다' },
  { value: 'by_date', emoji: '📅', label: '일자별 학습', desc: '특정 날짜에 업로드한 카드만 학습합니다' },
]

export function StudySetupPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()

  const [deck, setDeck] = useState<Deck | null>(null)
  const [loading, setLoading] = useState(true)
  const [cardCount, setCardCount] = useState(0)

  const [mode, setMode] = useState<StudyMode>('srs')
  const [batchSize, setBatchSize] = useState(20)

  // by_date mode state
  const [selectedDate, setSelectedDate] = useState(() => todayDateKey())
  const [datesWithCards, setDatesWithCards] = useState<Set<string>>(new Set())
  const [dateCardCount, setDateCardCount] = useState(0)

  useEffect(() => {
    if (!deckId) return
    const load = async () => {
      const { data: d } = await supabase
        .from('decks')
        .select('*')
        .eq('id', deckId)
        .single()
      setDeck(d as Deck | null)

      const { count } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('deck_id', deckId)
        .neq('srs_status', 'suspended')
      setCardCount(count ?? 0)

      // Fetch dates that have cards
      const { data: cardDates } = await supabase
        .from('cards')
        .select('created_at')
        .eq('deck_id', deckId)
        .neq('srs_status', 'suspended')
      if (cardDates) {
        const dates = new Set<string>()
        cardDates.forEach((c: { created_at: string }) => {
          dates.add(utcToLocalDateKey(c.created_at))
        })
        setDatesWithCards(dates)
      }

      setLoading(false)
    }
    load()
  }, [deckId])

  // Update date card count when selected date changes
  useEffect(() => {
    if (!deckId || mode !== 'by_date' || !selectedDate) return
    const fetchCount = async () => {
      const { start: dateStart, end: dateEnd } = localDateToUTCRange(selectedDate)
      const { count } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('deck_id', deckId)
        .neq('srs_status', 'suspended')
        .gte('created_at', dateStart)
        .lte('created_at', dateEnd)
      setDateCardCount(count ?? 0)
    }
    fetchCount()
  }, [deckId, mode, selectedDate])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    )
  }

  if (!deck) {
    navigate('/decks', { replace: true })
    return null
  }

  const handleStart = () => {
    const params = new URLSearchParams({
      mode,
      batchSize: String(batchSize),
    })
    if (mode === 'by_date' && selectedDate) {
      const { start, end } = localDateToUTCRange(selectedDate)
      params.set('dateStart', start)
      params.set('dateEnd', end)
    }
    navigate(`/decks/${deckId}/study?${params.toString()}`)
  }

  const isStartDisabled =
    cardCount === 0 ||
    (mode === 'by_date' && dateCardCount === 0)

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => navigate(`/decks/${deckId}`)}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        {deck.name}
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">학습 설정</h1>
      <p className="text-gray-500 text-sm mb-6">
        {deck.icon} {deck.name} · {cardCount}장
      </p>

      {/* Mode selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">학습 모드</label>
        <div className="space-y-2">
          {modeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all cursor-pointer ${
                mode === opt.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl">{opt.emoji}</div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 text-sm">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Batch size (not for SRS or by_date) */}
      {mode !== 'srs' && mode !== 'by_date' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            배치 크기
          </label>
          <input
            type="number"
            min={1}
            max={200}
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value) || 20)}
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">한 세션에 학습할 카드 수</p>
        </div>
      )}

      {/* Date picker (by_date mode) */}
      {mode === 'by_date' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            업로드 날짜 선택
          </label>
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
        </div>
      )}

      <button
        onClick={handleStart}
        disabled={isStartDisabled}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium rounded-xl transition cursor-pointer disabled:cursor-not-allowed"
      >
        학습 시작
      </button>
    </div>
  )
}
