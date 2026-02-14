import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { X, Volume2 } from 'lucide-react';
import { getCards, recordReview, getDeck } from '../lib/storage';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface Card {
  id: string;
  deckId: string;
  fields: Record<string, string>;
  status: string;
  nextReview: string | null;
}

interface Field {
  id: string;
  name: string;
  type: 'text' | 'image' | 'audio';
  ttsEnabled?: boolean;
  ttsLang?: string;
  ttsVoice?: string;
}

interface Deck {
  id: string;
  name: string;
  fields: Field[];
  frontLayout: { fieldId: string }[];
  backLayout: { fieldId: string }[];
}

export function StudySession() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const [cards, setCards] = useState<Card[]>([]);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [sessionStats, setSessionStats] = useState({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });
  const [swipeSettings, setSwipeSettings] = useState<any>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [swipeDelta, setSwipeDelta] = useState({ x: 0, y: 0 });

  useEffect(() => {
    fetchData();
    loadVoices();
    loadSwipeSettings();
  }, [deckId]);

  // Load TTS voices
  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    setAvailableVoices(voices);

    if (voices.length === 0) {
      speechSynthesis.addEventListener('voiceschanged', () => {
        setAvailableVoices(speechSynthesis.getVoices());
      });
    }
  }

  // Load swipe settings
  function loadSwipeSettings() {
    const saved = localStorage.getItem('reeecall-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      setSwipeSettings(settings.swipe || null);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handleFlip();
      } else if (flipped) {
        if (e.key === '1') handleRating(1);
        else if (e.key === '2') handleRating(2);
        else if (e.key === '3') handleRating(3);
        else if (e.key === '4') handleRating(4);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flipped, currentIndex]);

  function fetchData() {
    try {
      const data = getCards(deckId!);
      // Filter due cards
      const dueCards = data.filter((card: Card) => {
        if (!card.nextReview) return true;
        return new Date(card.nextReview) <= new Date();
      });
      setCards(dueCards);

      const deckData = getDeck(deckId!);
      setDeck(deckData);
    } catch (error) {
      console.error('Error fetching cards:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleRating(rating: 1 | 2 | 3 | 4) {
    const currentCard = cards[currentIndex];
    if (!currentCard) return;

    try {
      recordReview(deckId!, currentCard.id, rating);

      // Update stats
      const statsMap = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' } as const;
      setSessionStats((prev) => ({
        ...prev,
        [statsMap[rating]]: prev[statsMap[rating]] + 1,
      }));

      // Move to next card
      if (currentIndex < cards.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setFlipped(false);
      } else {
        // Session complete - show completion screen
        const totalReviewed = sessionStats.again + sessionStats.hard + sessionStats.good + sessionStats.easy + 1;
        const accuracy = ((sessionStats.good + sessionStats.easy + 1) / totalReviewed * 100).toFixed(0);
        
        toast.success(`학습 완료! ${totalReviewed}개 카드 복습, 정확도 ${accuracy}%`);
        setTimeout(() => {
          navigate(`/decks/${deckId}`);
        }, 2000);
      }
    } catch (error) {
      console.error('Error recording review:', error);
      toast.error('복습 기록에 실패했습니다.');
    }
  }

  function handleFlip() {
    const newFlipped = !flipped;
    setFlipped(newFlipped);
    
    // Auto-play TTS when flipping to back
    if (newFlipped && deck) {
      playBackTTS();
    }
  }

  function playBackTTS() {
    if (!deck || !currentCard) return;

    // Play TTS for all back layout fields that have TTS enabled
    deck.backLayout.forEach((layoutItem) => {
      const field = deck.fields.find(f => f.id === layoutItem.fieldId);
      if (field && field.ttsEnabled && field.type === 'text') {
        const fieldValue = currentCard.fields[field.name];
        if (fieldValue) {
          playTTS(fieldValue, field);
        }
      }
    });
  }

  function playTTS(text: string, field: Field) {
    if (!field.ttsEnabled || !field.ttsLang) return;

    // Cancel any ongoing speech
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = field.ttsLang;

    // Set voice if specified
    if (field.ttsVoice) {
      const voice = availableVoices.find(v => v.name === field.ttsVoice);
      if (voice) {
        utterance.voice = voice;
      }
    }

    speechSynthesis.speak(utterance);
  }

  function handleExit() {
    if (confirm('학습을 종료하시겠습니까?')) {
      navigate(`/decks/${deckId}`);
    }
  }

  // Swipe handlers
  function handleTouchStart(e: React.TouchEvent) {
    if (!swipeSettings?.enabled || !flipped) return;
    
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY });
    setSwipeDelta({ x: 0, y: 0 });
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!swipeSettings?.enabled || !touchStart || !flipped) return;
    
    const touch = e.touches[0];
    setSwipeDelta({
      x: touch.clientX - touchStart.x,
      y: touch.clientY - touchStart.y,
    });
  }

  function handleTouchEnd() {
    if (!swipeSettings?.enabled || !touchStart || !flipped) {
      setTouchStart(null);
      setSwipeDelta({ x: 0, y: 0 });
      return;
    }

    const SWIPE_THRESHOLD = 100;
    const actionMap: Record<string, 1 | 2 | 3 | 4> = {
      again: 1,
      hard: 2,
      good: 3,
      easy: 4,
    };

    // Determine swipe direction
    let action: 1 | 2 | 3 | 4 | null = null;

    if (Math.abs(swipeDelta.x) > Math.abs(swipeDelta.y)) {
      // Horizontal swipe
      if (swipeDelta.x > SWIPE_THRESHOLD && swipeSettings.right) {
        action = actionMap[swipeSettings.right];
      } else if (swipeDelta.x < -SWIPE_THRESHOLD && swipeSettings.left) {
        action = actionMap[swipeSettings.left];
      }
    } else {
      // Vertical swipe
      if (swipeDelta.y < -SWIPE_THRESHOLD && swipeSettings.up) {
        action = actionMap[swipeSettings.up];
      } else if (swipeDelta.y > SWIPE_THRESHOLD && swipeSettings.down) {
        action = actionMap[swipeSettings.down];
      }
    }

    if (action) {
      handleRating(action);
    }

    setTouchStart(null);
    setSwipeDelta({ x: 0, y: 0 });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (!deck || cards.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            학습할 카드가 없습니다
          </h2>
          <p className="text-gray-500 mb-6">모든 카드를 복습했습니다!</p>
          <button
            onClick={() => navigate(`/decks/${deckId}`)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            덱으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const currentCard = cards[currentIndex];
  const progress = ((currentIndex + 1) / cards.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Progress Bar */}
      <div className="sticky top-0 bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-green-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
              {currentIndex + 1} / {cards.length}
            </span>
          </div>
          <button
            onClick={handleExit}
            className="ml-4 p-2 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Card Area */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="relative"
              style={{ perspective: '1000px' }}
            >
              <motion.div
                animate={{ rotateY: flipped ? 180 : 0 }}
                transition={{ duration: 0.4 }}
                style={{ transformStyle: 'preserve-3d' }}
                className="bg-white rounded-2xl shadow-lg border border-gray-200 min-h-[400px] cursor-pointer"
                onClick={handleFlip}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                {/* Front */}
                <div
                  className="absolute inset-0 p-12 flex flex-col items-center justify-center"
                  style={{
                    backfaceVisibility: 'hidden',
                    display: flipped ? 'none' : 'flex',
                  }}
                >
                  <div className="text-5xl font-bold text-gray-900 text-center mb-6">
                    {currentCard.fields.front || currentCard.fields[Object.keys(currentCard.fields)[0]]}
                  </div>
                  <div className="text-sm text-gray-400 mt-auto">
                    Space로 뒤집기
                  </div>
                </div>

                {/* Back */}
                <div
                  className="absolute inset-0 p-12 flex flex-col items-center justify-center"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    display: flipped ? 'flex' : 'none',
                  }}
                >
                  <div className="text-xl text-gray-400 mb-4">
                    {currentCard.fields.front || currentCard.fields[Object.keys(currentCard.fields)[0]]}
                  </div>
                  <div className="text-4xl font-bold text-gray-900 text-center mb-6">
                    {currentCard.fields.back || currentCard.fields[Object.keys(currentCard.fields)[1]]}
                  </div>
                  {/* Show TTS button only if any back field has TTS enabled */}
                  {deck?.backLayout?.some((layoutItem) => {
                    const field = deck.fields.find(f => f.id === layoutItem.fieldId);
                    return field && field.ttsEnabled && field.type === 'text';
                  }) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playBackTTS();
                      }}
                      className="mt-4 p-2 text-blue-600 hover:text-blue-700 transition-colors"
                      title="TTS 재생"
                    >
                      <Volume2 className="w-6 h-6" />
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          </AnimatePresence>

          {/* Rating Buttons (only show when flipped) */}
          {flipped && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-4 gap-3 mt-6"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRating(1);
                }}
                className="py-4 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors flex flex-col items-center gap-1"
              >
                <span className="text-lg">Again</span>
                <span className="text-xs opacity-80">10분</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRating(2);
                }}
                className="py-4 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors flex flex-col items-center gap-1"
              >
                <span className="text-lg">Hard</span>
                <span className="text-xs opacity-80">1일</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRating(3);
                }}
                className="py-4 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors flex flex-col items-center gap-1"
              >
                <span className="text-lg">Good</span>
                <span className="text-xs opacity-80">3일</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRating(4);
                }}
                className="py-4 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors flex flex-col items-center gap-1"
              >
                <span className="text-lg">Easy</span>
                <span className="text-xs opacity-80">7일</span>
              </button>
            </motion.div>
          )}

          {/* Flip hint */}
          {!flipped && (
            <div className="text-center mt-6 text-gray-400 text-sm">
              카드를 클릭하여 답을 확인하세요
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="hidden">
        {/* Space to flip, 1-4 for ratings */}
      </div>
    </div>
  );
}