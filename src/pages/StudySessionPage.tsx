import { useEffect, useCallback, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { useStudyStore } from '../stores/study-store'
import { useAuthStore } from '../stores/auth-store'
import { supabase } from '../lib/supabase'
import { StudyCard } from '../components/study/StudyCard'
import { StudyProgressBar } from '../components/study/StudyProgressBar'
import { SrsRatingButtons } from '../components/study/SrsRatingButtons'
import { SimpleRatingButtons } from '../components/study/SimpleRatingButtons'
import { StudySummary } from '../components/study/StudySummary'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { stopSpeaking, getCardAudioUrl, getTTSFieldsForLayout, speak } from '../lib/tts'
import { loadSettings, shouldShowButtons, type StudyInputSettings } from '../lib/study-input-settings'
import type { StudyMode, Profile } from '../types/database'

export function StudySessionPage() {
  const { t } = useTranslation('study')
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
  const [inputSettings] = useState<StudyInputSettings>(() => loadSettings())

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

  // Compute TTS fields for current card
  const currentCard = queue[currentIndex] ?? null
  const frontTTSFields = useMemo(() => {
    if (!currentCard || !template) return []
    return getTTSFieldsForLayout(currentCard, template, 'front')
  }, [currentCard, template])
  const backTTSFields = useMemo(() => {
    if (!currentCard || !template) return []
    return getTTSFieldsForLayout(currentCard, template, 'back')
  }, [currentCard, template])

  // Auto-TTS on flip (only when profile.tts_enabled)
  useEffect(() => {
    if (!isFlipped || !template || !config) return
    const card = queue[currentIndex]
    if (!card) return

    // Audio field takes priority
    const audioUrl = getCardAudioUrl(card, template)
    if (audioUrl) {
      const audio = new Audio(audioUrl)
      audio.play().catch(() => {})
      return
    }

    // Auto-read TTS-enabled fields if profile setting is on
    if (profile?.tts_enabled && backTTSFields.length > 0) {
      speak(backTTSFields[0].text, backTTSFields[0].lang)
    }
  }, [isFlipped, currentIndex, template, config, queue, profile, backTTSFields])

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
        <div className="text-gray-500">{t('session.loading')}</div>
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
            {t('session.noCards')}
          </h2>
          <p className="text-gray-500 mb-6">{t('session.allReviewed')}</p>
          <button
            onClick={handleExit}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            {t('session.backToDeck')}
          </button>
        </div>
      </div>
    )
  }

  if (!currentCard) return null

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Branding */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 py-2.5 sm:py-3 flex items-center justify-center gap-2.5">
          <img src="/favicon.png" alt="" className="w-8 h-8 sm:w-10 sm:h-10 object-contain" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-6 sm:h-8 object-contain" />
        </div>
      </div>

      {/* Top bar */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <StudyProgressBar
            current={sessionStats.cardsStudied}
            total={sessionStats.totalCards}
          />
          <div className="flex items-center gap-2 ml-4">
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
        frontTTSFields={frontTTSFields}
        backTTSFields={backTTSFields}
        onSwipeRate={handleRate}
        inputSettings={inputSettings}
      />

      {/* Rating buttons (hidden in swipe mode) */}
      {shouldShowButtons(inputSettings) && (
        <div className="px-3 sm:px-6 py-3 sm:py-6 max-w-2xl mx-auto w-full">
          {isFlipped ? (
            config?.mode === 'srs' ? (
              <SrsRatingButtons card={currentCard} srsSettings={srsSettings} onRate={handleRate} />
            ) : (
              <SimpleRatingButtons mode={config?.mode ?? 'random'} onRate={handleRate} />
            )
          ) : null}
        </div>
      )}
    </div>
  )
}
