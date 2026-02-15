import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { daysAgoUTC } from '../lib/date-utils'
import { useDeckStore } from '../stores/deck-store'
import { DEFAULT_SRS_SETTINGS } from '../types/database'
import type { Deck, Card, StudyLog } from '../types/database'
import {
  calculateDeckStats,
  getDailyStudyCounts,
  getHeatmapData,
  getStreakDays,
  filterLogsByPeriod,
} from '../lib/stats'
import { periodToDays, shouldShowHeatmap } from '../lib/time-period'
import type { TimePeriod } from '../lib/time-period'
import { DeckSettingsForm, COLORS, ICONS } from '../components/deck/DeckSettingsForm'
import type { DeckSettingsFormValues } from '../components/deck/DeckSettingsForm'
import { TimePeriodTabs } from '../components/common/TimePeriodTabs'
import { DailyStudyChart } from '../components/dashboard/DailyStudyChart'
import { StudyHeatmap } from '../components/dashboard/StudyHeatmap'

const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  learning: '#f59e0b',
  review: '#22c55e',
}

export function DeckEditPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const { updateDeck, templates, fetchTemplates } = useDeckStore()

  const [deck, setDeck] = useState<Deck | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState<TimePeriod>('1m')

  const [formValues, setFormValues] = useState<DeckSettingsFormValues>({
    name: '',
    description: '',
    color: COLORS[0],
    icon: ICONS[0],
    templateId: '',
    srsSettings: { ...DEFAULT_SRS_SETTINGS },
  })

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    if (!deckId) return
    let cancelled = false

    const fetchData = async () => {
      setLoading(true)

      const [deckRes, cardsRes, logsRes] = await Promise.all([
        supabase.from('decks').select('*').eq('id', deckId).single(),
        supabase.from('cards').select('*').eq('deck_id', deckId),
        supabase
          .from('study_logs')
          .select('*')
          .eq('deck_id', deckId)
          .gte('studied_at', daysAgoUTC(365))
          .order('studied_at', { ascending: false }),
      ])

      if (cancelled) return

      const deckData = deckRes.data as Deck | null
      if (!deckData) {
        navigate('/decks', { replace: true })
        return
      }

      setDeck(deckData)
      setCards((cardsRes.data ?? []) as Card[])
      setStudyLogs((logsRes.data ?? []) as StudyLog[])

      setFormValues({
        name: deckData.name,
        description: deckData.description || '',
        color: deckData.color,
        icon: deckData.icon,
        templateId: deckData.default_template_id || '',
        srsSettings: deckData.srs_settings ?? { ...DEFAULT_SRS_SETTINGS },
      })

      setLoading(false)
    }

    fetchData()
    return () => { cancelled = true }
  }, [deckId, navigate])

  const handleSave = async () => {
    if (!deckId || !formValues.name.trim()) {
      toast.error('덱 이름을 입력해주세요.')
      return
    }

    setSaving(true)
    await updateDeck(deckId, {
      name: formValues.name.trim(),
      description: formValues.description.trim() || null,
      color: formValues.color,
      icon: formValues.icon,
      default_template_id: formValues.templateId || null,
      srs_settings: formValues.srsSettings,
    })
    setSaving(false)
    toast.success('덱이 저장되었습니다.')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📚</div>
      </div>
    )
  }

  if (!deck) return null

  // Stats
  const deckStats = calculateDeckStats(cards)
  const days = periodToDays(period)
  const filteredLogs = filterLogsByPeriod(studyLogs, days)
  const dailyData = getDailyStudyCounts(filteredLogs, days)
  const heatmapData = getHeatmapData(filteredLogs)
  const streak = getStreakDays(studyLogs)

  const pieData = [
    { name: 'New', value: deckStats.newCount, color: STATUS_COLORS.new },
    { name: 'Learning', value: deckStats.learningCount, color: STATUS_COLORS.learning },
    { name: 'Review', value: deckStats.reviewCount, color: STATUS_COLORS.review },
  ].filter((d) => d.value > 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">덱 편집</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition"
        >
          <Save size={16} />
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Deck Settings */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">덱 설정</h2>
          <DeckSettingsForm
            values={formValues}
            onChange={setFormValues}
            templates={templates}
          />
        </div>

        {/* Right: Deck Stats */}
        <div className="space-y-6">
          {/* Period tabs */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">덱 통계</h2>
            <TimePeriodTabs value={period} onChange={setPeriod} />
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="전체 카드" value={deckStats.totalCards} />
            <StatCard label="숙달률" value={`${deckStats.masteryRate}%`} />
            <StatCard label="연속 학습" value={`${streak}일`} />
            <StatCard label="평균 간격" value={`${deckStats.avgInterval}일`} />
          </div>

          {/* Pie chart */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-medium text-gray-700 mb-3">상태 분포</h3>
            {deckStats.totalCards === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">카드가 없습니다</p>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value}장`]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-sm">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="text-gray-700">{d.name}</span>
                      <span className="text-gray-400">{d.value}장</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Heatmap (1m+) */}
          {shouldShowHeatmap(period) && <StudyHeatmap data={heatmapData} />}

          {/* Daily study chart */}
          <DailyStudyChart data={dailyData} />
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
