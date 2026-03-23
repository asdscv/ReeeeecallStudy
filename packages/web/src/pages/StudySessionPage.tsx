import { useEffect, useCallback, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { X, Undo2, Keyboard } from 'lucide-react'
import { useStudyStore } from '../stores/study-store'
import { useAuthStore } from '../stores/auth-store'
import { useAchievementStore } from '../stores/achievement-store'
import { supabase } from '../lib/supabase'
import { StudyCard } from '../components/study/StudyCard'
import { StudyProgressBar } from '../components/study/StudyProgressBar'
import { CrammingProgressBar } from '../components/study/CrammingProgressBar'
import { SrsRatingButtons } from '../components/study/SrsRatingButtons'
import { SimpleRatingButtons } from '../components/study/SimpleRatingButtons'
import { CrammingRatingButtons } from '../components/study/CrammingRatingButtons'
import { StudySummary } from '../components/study/StudySummary'
import { CrammingSummary } from '../components/study/CrammingSummary'
import { NoCardsDue } from '../components/study/NoCardsDue'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { KeyboardShortcutsModal } from '../components/study/KeyboardShortcutsModal'
// PomodoroTimer available at ../components/study/PomodoroTimer (not used in default study flow)
import { getSessionSummaryType } from '../lib/study-summary-type'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { stopSpeaking, getCardAudioUrl, getTTSFieldsForLayout, speak, type TTSOptions } from '../lib/tts'
import { loadSettings, shouldShowButtons, getDirectionsForMode, type StudyInputSettings, type SwipeDirectionMap } from '../lib/study-input-settings'
import type { CrammingFilter } from '../lib/cramming-queue'
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
    crammingManager,
    exitDirection,
    lastRatedCard,
    initSession,
    flipCard,
    rateCard,
    exitSession,
    undoLastRating,
    reset,
  } = useStudyStore()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [inputSettings, setInputSettings] = useState<StudyInputSettings>(() => loadSettings())
  const [crammingTimeRemaining, setCrammingTimeRemaining] = useState<number | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showUndo, setShowUndo] = useState(false)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch profile for TTS settings
  useEffect(() => {
    if (!user) return
    const fetchProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (data) {
        const p = data as Profile
        setProfile(p)
        if (p.answer_mode && (p.answer_mode === 'button' || p.answer_mode === 'swipe')) {
          setInputSettings({ version: 3, mode: p.answer_mode })
        }
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

    // Parse cramming params
    let crammingFilter: CrammingFilter | undefined
    let crammingTimeLimitMinutes: number | null | undefined
    let crammingShuffle: boolean | undefined

    if (mode === 'cramming') {
      const filterStr = searchParams.get('crammingFilter')
      if (filterStr) {
        try { crammingFilter = JSON.parse(filterStr) } catch { crammingFilter = { type: 'all' } }
      } else {
        crammingFilter = { type: 'all' }
      }
      const timeLimitStr = searchParams.get('crammingTimeLimit')
      crammingTimeLimitMinutes = timeLimitStr ? Number(timeLimitStr) : null
      crammingShuffle = searchParams.get('crammingShuffle') !== 'false'
    }

    initSession({
      deckId,
      mode,
      batchSize,
      uploadDateStart: dateStart,
      uploadDateEnd: dateEnd,
      crammingFilter,
      crammingTimeLimitMinutes,
      crammingShuffle,
    })

    return () => {
      stopSpeaking()
    }
  }, [deckId, searchParams, initSession])

  // Cramming timer countdown
  useEffect(() => {
    if (!crammingManager || !crammingManager.hasTimeLimit() || phase !== 'studying') return

    const interval = setInterval(() => {
      const remaining = crammingManager.remainingTimeMs()
      setCrammingTimeRemaining(remaining)

      if (remaining != null && remaining <= 0) {
        // Time's up - use dedicated store action to gracefully end
        useStudyStore.getState().crammingTimeUp()
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [crammingManager, phase])

  // Compute swipe directions based on study mode
  const swipeDirections = useMemo<SwipeDirectionMap>(
    () => getDirectionsForMode(config?.mode),
    [config?.mode],
  )

  // Compute current card (cramming uses crammingManager for card ID)
  const currentCard = useMemo(() => {
    if (config?.mode === 'cramming' && crammingManager) {
      const cardId = crammingManager.currentCardId()
      return cardId ? queue.find(c => c.id === cardId) ?? null : null
    }
    return queue[currentIndex] ?? null
  }, [config, crammingManager, queue, currentIndex])
  const frontTTSFields = useMemo(() => {
    if (!currentCard || !template) return []
    return getTTSFieldsForLayout(currentCard, template, 'front')
  }, [currentCard, template])
  const backTTSFields = useMemo(() => {
    if (!currentCard || !template) return []
    return getTTSFieldsForLayout(currentCard, template, 'back')
  }, [currentCard, template])

  // TTS options derived from profile (extensible: rate, pitch, volume, provider)
  const ttsOptions = useMemo<TTSOptions>(() => ({
    rate: profile?.tts_speed ?? 0.9,
    provider: profile?.tts_provider ?? 'web_speech',
  }), [profile?.tts_speed, profile?.tts_provider])

  // Auto-TTS on flip (only when profile.tts_enabled)
  useEffect(() => {
    if (!isFlipped || !template || !config || !currentCard) return

    // Audio field takes priority
    const audioUrl = getCardAudioUrl(currentCard, template)
    if (audioUrl) {
      const audio = new Audio(audioUrl)
      audio.play().catch(() => {})
      return
    }

    // Auto-read TTS-enabled fields if profile setting is on
    if (profile?.tts_enabled && backTTSFields.length > 0) {
      speak(backTTSFields[0].text, backTTSFields[0].lang, ttsOptions)
    }
  }, [isFlipped, currentCard, template, config, profile, backTTSFields, ttsOptions])

  // Stop TTS, check achievements, and update quest progress when session completes
  const checkAchievements = useAchievementStore(s => s.checkAchievements)
  useEffect(() => {
    if (phase === 'completed') {
      stopSpeaking()
      checkAchievements()

      // Update daily quest progress
      const cardsStudied = sessionStats.cardsStudied
      const durationMinutes = Math.round(sessionStats.totalDurationMs / 60000)
      if (cardsStudied > 0) {
        supabase.rpc('update_quest_progress', {
          p_cards_studied: cardsStudied,
          p_duration_minutes: durationMinutes,
        }).then(() => {})
      }
    }
  }, [phase, checkAchievements, sessionStats.cardsStudied, sessionStats.totalDurationMs])

  const handleRate = useCallback((rating: string) => {
    rateCard(rating)
  }, [rateCard])

  const handleExit = useCallback(() => {
    setShowExitConfirm(true)
  }, [])

  const handleConfirmExit = useCallback(() => {
    setShowExitConfirm(false)
    stopSpeaking()
    if (sessionStats.cardsStudied > 0) {
      exitSession()
    } else {
      reset()
      navigate(`/decks/${deckId}`)
    }
  }, [sessionStats.cardsStudied, exitSession, reset, navigate, deckId])

  const handleFlip = useCallback(() => {
    flipCard()
  }, [flipCard])

  const handleUndo = useCallback(() => {
    if (!lastRatedCard) return
    undoLastRating()
    setShowUndo(false)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }, [lastRatedCard, undoLastRating])

  const handleToggleShortcuts = useCallback(() => {
    setShowShortcuts(prev => !prev)
  }, [])

  // Show undo button for 5 seconds after rating
  useEffect(() => {
    if (lastRatedCard) {
      setShowUndo(true)
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
      undoTimerRef.current = setTimeout(() => {
        setShowUndo(false)
      }, 5000)
    } else {
      setShowUndo(false)
    }
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [lastRatedCard])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    isFlipped,
    mode: config?.mode ?? 'srs',
    onFlip: handleFlip,
    onRate: handleRate,
    onExit: handleExit,
    onUndo: handleUndo,
    onHelp: handleToggleShortcuts,
  })

  // Loading state
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">{t('session.loading')}</div>
      </div>
    )
  }

  // Completed state
  if (phase === 'completed') {
    const summaryType = getSessionSummaryType(sessionStats.totalCards, sessionStats.cardsStudied)

    if (summaryType === 'no-cards') {
      return (
        <NoCardsDue
          mode={config?.mode ?? 'srs'}
          crammingFilter={config?.crammingFilter}
          onBackToDeck={() => {
            reset()
            navigate(`/decks/${deckId}`)
          }}
          onOtherMode={() => {
            reset()
            navigate(`/decks/${deckId}/study/setup`)
          }}
        />
      )
    }

    if (config?.mode === 'cramming' && crammingManager) {
      const hardestCards = crammingManager.getHardestCards(5)
      return (
        <CrammingSummary
          stats={sessionStats}
          crammingMeta={{
            rounds: crammingManager.currentRound(),
            masteryPercentage: crammingManager.masteryPercentage(),
            allMastered: crammingManager.isAllMastered(),
            hardestCards: hardestCards.map(c => ({
              cardId: c.cardId,
              missedCount: c.missedCount,
            })),
          }}
          cards={queue}
          template={template}
          summaryType={summaryType}
          onBackToDeck={() => {
            reset()
            navigate(`/decks/${deckId}`)
          }}
          onCrammingAgain={() => {
            reset()
            navigate(`/decks/${deckId}/study/setup`)
          }}
          onOtherMode={() => {
            reset()
            navigate(`/decks/${deckId}/study/setup`)
          }}
        />
      )
    }

    return (
      <StudySummary
        stats={sessionStats}
        summaryType={summaryType}
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {t('session.noCards')}
          </h2>
          <p className="text-muted-foreground mb-6">{t('session.allReviewed')}</p>
          <button
            onClick={handleExit}
            className="px-6 py-3 bg-brand text-white rounded-lg hover:bg-brand cursor-pointer"
          >
            {t('session.backToDeck')}
          </button>
        </div>
      </div>
    )
  }

  if (!currentCard) return null

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden" style={{ overscrollBehavior: 'contain' }}>
      {/* Branding */}
      <div className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-2.5 sm:py-3.5 flex items-center justify-center gap-2.5">
          <img src="/favicon.png" alt="" className="w-8 h-8 sm:w-12 sm:h-12 object-contain" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-7 sm:h-10 object-contain dark:brightness-0 dark:invert" />
        </div>
      </div>

      {/* Top bar */}
      <div className="sticky top-0 bg-card border-b border-border z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          {config?.mode === 'cramming' && crammingManager ? (
            <CrammingProgressBar
              round={crammingManager.currentRound()}
              remainingInRound={crammingManager.remainingInRound()}
              totalInRound={crammingManager.totalInRound()}
              masteryPct={crammingManager.masteryPercentage()}
              timeRemainingMs={crammingTimeRemaining}
            />
          ) : (
            <StudyProgressBar
              current={sessionStats.cardsStudied + 1}
              total={sessionStats.totalCards}
            />
          )}
          <div className="flex items-center gap-1 ml-4">
            {/* Keyboard shortcuts button — PC only (hidden on touch devices) */}
            <button
              onClick={handleToggleShortcuts}
              className="hidden sm:block p-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title={t('shortcuts.title')}
            >
              <Keyboard className="w-5 h-5" />
            </button>
            <button
              onClick={handleExit}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
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
        swipeDirections={swipeDirections}
        exitDirection={exitDirection}
        ttsOptions={ttsOptions}
      />

      {/* Rating buttons (hidden in swipe mode) */}
      {shouldShowButtons(inputSettings) && (
        <div className="px-3 sm:px-6 py-3 sm:py-6 max-w-2xl mx-auto w-full">
          {isFlipped ? (
            config?.mode === 'cramming' ? (
              <CrammingRatingButtons onRate={handleRate} />
            ) : config?.mode === 'srs' ? (
              <SrsRatingButtons card={currentCard} srsSettings={srsSettings} onRate={handleRate} />
            ) : (
              <SimpleRatingButtons mode={config?.mode ?? 'random'} onRate={handleRate} />
            )
          ) : null}
        </div>
      )}

      {/* Undo button */}
      {showUndo && lastRatedCard && (
        <div className="fixed bottom-6 left-6 z-20">
          <button
            onClick={handleUndo}
            className="flex items-center gap-2 px-4 py-2 text-sm text-foreground bg-card border border-border rounded-lg shadow-md hover:bg-muted transition-colors cursor-pointer"
          >
            <Undo2 className="w-4 h-4" />
            {t('session.undo')}
          </button>
        </div>
      )}

      {/* Exit confirmation dialog */}
      <ConfirmDialog
        open={showExitConfirm}
        onClose={() => setShowExitConfirm(false)}
        onConfirm={handleConfirmExit}
        title={t('session.exitConfirmTitle')}
        message={t('session.exitConfirmMessage')}
        confirmLabel={t('session.exitConfirmButton')}
      />

      {/* Keyboard shortcuts modal */}
      <KeyboardShortcutsModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        mode={config?.mode ?? 'srs'}
        isSwipeMode={!shouldShowButtons(inputSettings)}
      />
    </div>
  )
}
