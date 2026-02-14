import { useEffect, useCallback, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { X, Volume2 } from 'lucide-react'
import { useStudyStore } from '../stores/study-store'
import { useAuthStore } from '../stores/auth-store'
import { supabase } from '../lib/supabase'
import { StudyCard } from '../components/study/StudyCard'
import { StudyProgressBar } from '../components/study/StudyProgressBar'
import { SrsRatingButtons } from '../components/study/SrsRatingButtons'
import { SimpleRatingButtons } from '../components/study/SimpleRatingButtons'
import { StudySummary } from '../components/study/StudySummary'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { speakWithProfile, stopSpeaking, getCardAudioUrl, getCardTTSText, speak } from '../lib/tts'
import type { StudyMode, Profile } from '../types/database'

interface SwipeSettings {
  enabled: boolean
  left: string
  right: string
  up: string
  down: string
}

export function StudySessionPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const {
    phase,
    config,
    template,
    srsSettings,
    queue,
    currentIndex,
    isFlipped,
    sessionStats,
    initSession,
    flipCard,
    rateCard,
    reset,
  } = useStudyStore()

  const [profile, setProfile] = useState<Pick<Profile, 'tts_enabled' | 'tts_lang'> | null>(null)
  const [swipeSettings, setSwipeSettings] = useState<SwipeSettings | null>(null)

  // Load swipe settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('reeecall-swipe-settings')
    if (saved) {
      try {
        setSwipeSettings(JSON.parse(saved))
      } catch { /* ignore */ }
    }
  }, [])

  // Fetch profile for TTS settings
  useEffect(() => {
    if (!user) return
    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('tts_enabled, tts_lang')
        .eq('id', user.id)
        .single()
      if (data) {
        setProfile(data as Pick<Profile, 'tts_enabled' | 'tts_lang'>)
      }
    }
    fetchProfile()
  }, [user])

  // Initialize session on mount
  useEffect(() => {
    if (!deckId) return

    const mode = (searchParams.get('mode') ?? 'srs') as StudyMode
    const batchSize = Number(searchParams.get('batchSize')) || 20
    const dateStart = searchParams.get('dateStart') || undefined
    const dateEnd = searchParams.get('dateEnd') || undefined

    initSession({
      deckId,
      mode,
      batchSize,
      uploadDateStart: dateStart,
      uploadDateEnd: dateEnd,
    })

    return () => {
      stopSpeaking()
    }
  }, [deckId, searchParams, initSession])

  // TTS on flip
  useEffect(() => {
    if (isFlipped && template && config) {
      const card = queue[currentIndex]
      if (!card) return

      const audioUrl = getCardAudioUrl(card, template)
      if (audioUrl) {
        const audio = new Audio(audioUrl)
        audio.play().catch(() => {})
        return
      }

      if (profile) {
        const primaryItem = template.back_layout.find(item => item.style === 'primary')
        if (primaryItem) {
          const text = card.field_values[primaryItem.field_key]
          if (text) {
            speakWithProfile(text, profile)
          }
        }
      }
    }
  }, [isFlipped, currentIndex, template, config, queue, profile])

  const handleManualTTS = useCallback(() => {
    if (!template) return
    const card = queue[currentIndex]
    if (!card) return

    const audioUrl = getCardAudioUrl(card, template)
    if (audioUrl) {
      const audio = new Audio(audioUrl)
      audio.play().catch(() => {})
      return
    }

    const layout = isFlipped ? template.back_layout : template.front_layout
    const ttsText = getCardTTSText(card, { ...template, front_layout: layout })
    if (ttsText) {
      if (profile?.tts_lang) {
        speak(ttsText, profile.tts_lang)
      } else {
        speak(ttsText)
      }
    }
  }, [template, queue, currentIndex, isFlipped, profile])

  const handleRate = useCallback((rating: string) => {
    rateCard(rating)
  }, [rateCard])

  const handleExit = useCallback(() => {
    reset()
    navigate(`/decks/${deckId}`)
  }, [reset, navigate, deckId])

  const handleFlip = useCallback(() => {
    flipCard()
  }, [flipCard])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    isFlipped,
    mode: config?.mode ?? 'srs',
    onFlip: handleFlip,
    onRate: handleRate,
    onExit: handleExit,
  })

  // Loading state
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    )
  }

  // Completed state
  if (phase === 'completed') {
    return (
      <StudySummary
        stats={sessionStats}
        onBackToDeck={() => {
          reset()
          navigate(`/decks/${deckId}`)
        }}
        onStudyAgain={() => {
          reset()
          navigate(`/decks/${deckId}/study/setup`)
        }}
      />
    )
  }

  // Idle / no cards
  if (phase === 'idle' || queue.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            학습할 카드가 없습니다
          </h2>
          <p className="text-gray-500 mb-6">모든 카드를 복습했습니다!</p>
          <button
            onClick={handleExit}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            덱으로 돌아가기
          </button>
        </div>
      </div>
    )
  }

  const currentCard = queue[currentIndex]
  if (!currentCard) return null

  const hasTTS = profile?.tts_enabled || (template && getCardAudioUrl(currentCard, template))

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <StudyProgressBar
            current={sessionStats.cardsStudied}
            total={sessionStats.totalCards}
          />
          <div className="flex items-center gap-2 ml-4">
            {hasTTS && (
              <button
                onClick={handleManualTTS}
                className="p-2 text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
                title="발음 듣기"
              >
                <Volume2 className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={handleExit}
              className="p-2 text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Card area */}
      <StudyCard
        card={currentCard}
        template={template}
        isFlipped={isFlipped}
        onFlip={handleFlip}
        onManualTTS={handleManualTTS}
        showTTSButton={!!hasTTS}
        onSwipeRate={handleRate}
        swipeSettings={swipeSettings}
      />

      {/* Rating buttons */}
      <div className="px-6 py-6 max-w-2xl mx-auto w-full">
        {isFlipped ? (
          config?.mode === 'srs' ? (
            <SrsRatingButtons card={currentCard} srsSettings={srsSettings} onRate={handleRate} />
          ) : (
            <SimpleRatingButtons mode={config?.mode ?? 'random'} onRate={handleRate} />
          )
        ) : null}
      </div>
    </div>
  )
}
