import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Volume2 } from 'lucide-react'
import type { Card, CardTemplate, LayoutItem } from '../../types/database'

interface StudyCardProps {
  card: Card
  template: CardTemplate | null
  isFlipped: boolean
  onFlip: () => void
  onManualTTS?: () => void
  showTTSButton?: boolean
  // Swipe support
  onSwipeRate?: (rating: string) => void
  swipeSettings?: SwipeSettings | null
}

interface SwipeSettings {
  enabled: boolean
  left: string
  right: string
  up: string
  down: string
}

export function StudyCard({
  card,
  template,
  isFlipped,
  onFlip,
  onManualTTS,
  showTTSButton,
  onSwipeRate,
  swipeSettings,
}: StudyCardProps) {
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const [swipeDelta, setSwipeDelta] = useState({ x: 0, y: 0 })

  const frontLayout = template?.front_layout ?? []
  const backLayout = template?.back_layout ?? []
  const fields = template?.fields ?? []

  // Get primary display values
  const frontValue = frontLayout.length > 0
    ? card.field_values[frontLayout[0].field_key] ?? ''
    : Object.values(card.field_values)[0] ?? ''

  const backValue = backLayout.length > 0
    ? card.field_values[backLayout[0].field_key] ?? ''
    : Object.values(card.field_values)[1] ?? Object.values(card.field_values)[0] ?? ''

  // Swipe handlers
  function handleTouchStart(e: React.TouchEvent) {
    if (!swipeSettings?.enabled || !isFlipped) return
    const touch = e.touches[0]
    setTouchStart({ x: touch.clientX, y: touch.clientY })
    setSwipeDelta({ x: 0, y: 0 })
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!swipeSettings?.enabled || !touchStart || !isFlipped) return
    const touch = e.touches[0]
    setSwipeDelta({
      x: touch.clientX - touchStart.x,
      y: touch.clientY - touchStart.y,
    })
  }

  function handleTouchEnd() {
    if (!swipeSettings?.enabled || !touchStart || !isFlipped) {
      setTouchStart(null)
      setSwipeDelta({ x: 0, y: 0 })
      return
    }

    const SWIPE_THRESHOLD = 100

    if (Math.abs(swipeDelta.x) > Math.abs(swipeDelta.y)) {
      if (swipeDelta.x > SWIPE_THRESHOLD && swipeSettings.right) {
        onSwipeRate?.(swipeSettings.right)
      } else if (swipeDelta.x < -SWIPE_THRESHOLD && swipeSettings.left) {
        onSwipeRate?.(swipeSettings.left)
      }
    } else {
      if (swipeDelta.y < -SWIPE_THRESHOLD && swipeSettings.up) {
        onSwipeRate?.(swipeSettings.up)
      } else if (swipeDelta.y > SWIPE_THRESHOLD && swipeSettings.down) {
        onSwipeRate?.(swipeSettings.down)
      }
    }

    setTouchStart(null)
    setSwipeDelta({ x: 0, y: 0 })
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative"
            style={{ perspective: '1000px' }}
          >
            <motion.div
              animate={{ rotateY: isFlipped ? 180 : 0 }}
              transition={{ duration: 0.4 }}
              style={{ transformStyle: 'preserve-3d' }}
              className="bg-white rounded-2xl shadow-lg border border-gray-200 min-h-[400px] cursor-pointer"
              onClick={!isFlipped ? onFlip : undefined}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* Front Face */}
              <div
                className="absolute inset-0 p-12 flex flex-col items-center justify-center"
                style={{
                  backfaceVisibility: 'hidden',
                  display: isFlipped ? 'none' : 'flex',
                }}
              >
                {frontLayout.length > 0 ? (
                  <div className="space-y-4 text-center">
                    {frontLayout.map((item, idx) => (
                      <LayoutItemRenderer
                        key={idx}
                        item={item}
                        value={card.field_values[item.field_key] ?? ''}
                        fieldType={fields.find(f => f.key === item.field_key)?.type ?? 'text'}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-5xl font-bold text-gray-900 text-center">
                    {frontValue}
                  </div>
                )}
                <div className="text-sm text-gray-400 mt-auto pt-6">
                  Space로 뒤집기
                </div>
              </div>

              {/* Back Face */}
              <div
                className="absolute inset-0 p-12 flex flex-col items-center justify-center"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  display: isFlipped ? 'flex' : 'none',
                }}
              >
                <div className="text-xl text-gray-400 mb-4">
                  {frontValue}
                </div>
                {backLayout.length > 0 ? (
                  <div className="space-y-4 text-center">
                    {backLayout.map((item, idx) => (
                      <LayoutItemRenderer
                        key={idx}
                        item={item}
                        value={card.field_values[item.field_key] ?? ''}
                        fieldType={fields.find(f => f.key === item.field_key)?.type ?? 'text'}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-4xl font-bold text-gray-900 text-center">
                    {backValue}
                  </div>
                )}
                {showTTSButton && onManualTTS && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onManualTTS()
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

        {/* Flip hint */}
        {!isFlipped && (
          <div className="text-center mt-6 text-gray-400 text-sm">
            카드를 클릭하여 답을 확인하세요
          </div>
        )}
      </div>
    </div>
  )
}

function LayoutItemRenderer({
  item,
  value,
  fieldType,
}: {
  item: LayoutItem
  value: string
  fieldType: 'text' | 'image' | 'audio'
}) {
  if (!value) return null

  if (item.style === 'media' || fieldType === 'image') {
    return (
      <div className="flex justify-center">
        <img src={value} alt="" className="max-h-64 rounded-lg object-contain" />
      </div>
    )
  }

  if (fieldType === 'audio') {
    return (
      <div className="flex justify-center">
        <audio controls src={value} className="w-full max-w-md" />
      </div>
    )
  }

  const styleClasses: Record<string, string> = {
    primary: 'text-4xl font-bold text-gray-900',
    secondary: 'text-xl text-gray-700',
    hint: 'text-lg italic text-gray-400',
    detail: 'text-base text-gray-600',
    media: 'text-base text-gray-600',
  }

  return (
    <p className={styleClasses[item.style] ?? styleClasses.primary}>
      {value}
    </p>
  )
}
