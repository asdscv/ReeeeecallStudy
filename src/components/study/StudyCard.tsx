import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Volume2 } from 'lucide-react'
import { renderCardFace } from '../../lib/card-renderer'
import { getLayoutItemStyle } from '../../lib/layout-styles'
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

  // Get primary display values (fallback when no layout)
  const frontValue = frontLayout.length > 0
    ? card.field_values[frontLayout[0].field_key] ?? ''
    : Object.values(card.field_values)[0] ?? ''

  const backValue = backLayout.length > 0
    ? card.field_values[backLayout[0].field_key] ?? ''
    : Object.values(card.field_values)[1] ?? Object.values(card.field_values)[0] ?? ''

  // Centralized rendering decision (memoized)
  const frontRender = useMemo(
    () => renderCardFace(template, card, 'front'),
    [template, card],
  )
  const backRender = useMemo(
    () => renderCardFace(template, card, 'back'),
    [template, card],
  )

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
              onClick={onFlip}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* Front Face */}
              <div
                className="absolute inset-0 p-8 sm:p-12 flex flex-col items-center justify-center"
                style={{
                  backfaceVisibility: 'hidden',
                  display: isFlipped ? 'none' : 'flex',
                }}
              >
                {frontRender.mode === 'custom' ? (
                  <div
                    className="prose prose-sm max-w-none text-center"
                    dangerouslySetInnerHTML={{ __html: frontRender.html }}
                  />
                ) : frontLayout.length > 0 ? (
                  <CardFaceLayout
                    layout={frontLayout}
                    fieldValues={card.field_values}
                    fields={fields}
                  />
                ) : (
                  <div className="text-5xl font-bold text-gray-900 text-center tracking-tight">
                    {frontValue}
                  </div>
                )}
                <div className="text-sm text-gray-400 mt-auto pt-6">
                  Space로 뒤집기
                </div>
              </div>

              {/* Back Face */}
              <div
                className="absolute inset-0 p-8 sm:p-12 flex flex-col items-center justify-center"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  display: isFlipped ? 'flex' : 'none',
                }}
              >
                {backRender.mode === 'custom' ? (
                  <div
                    className="prose prose-sm max-w-none text-center"
                    dangerouslySetInnerHTML={{ __html: backRender.html }}
                  />
                ) : (
                  <>
                    {/* Small reminder of front value */}
                    <div className="text-base text-gray-300 mb-6 tracking-wide">
                      {frontValue}
                    </div>
                    {backLayout.length > 0 ? (
                      <CardFaceLayout
                        layout={backLayout}
                        fieldValues={card.field_values}
                        fields={fields}
                      />
                    ) : (
                      <div className="text-4xl font-bold text-gray-900 text-center tracking-tight">
                        {backValue}
                      </div>
                    )}
                  </>
                )}
                {showTTSButton && onManualTTS && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onManualTTS()
                    }}
                    className="mt-6 p-2.5 text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
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

// ── Card Face Layout ─────────────────────────────────────
// Renders a list of layout items with proper visual hierarchy,
// spacing, and separators between different style groups.

function CardFaceLayout({
  layout,
  fieldValues,
  fields,
}: {
  layout: LayoutItem[]
  fieldValues: Record<string, string>
  fields: { key: string; type: string }[]
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 w-full max-w-lg text-center">
      {layout.map((item, idx) => {
        const value = fieldValues[item.field_key] ?? ''
        const fieldType = fields.find(f => f.key === item.field_key)?.type ?? 'text'

        // Insert a subtle divider before hint/detail sections
        // (only if preceded by a primary/secondary item)
        const prevStyle = idx > 0 ? layout[idx - 1].style : null
        const needsDivider =
          idx > 0 &&
          (item.style === 'hint' || item.style === 'detail') &&
          (prevStyle === 'primary' || prevStyle === 'secondary')

        return (
          <div key={item.field_key + '-' + idx} className="w-full">
            {needsDivider && (
              <div className="w-12 h-px bg-gray-200 mx-auto mb-3" />
            )}
            <LayoutItemRenderer
              item={item}
              value={value}
              fieldType={fieldType as 'text' | 'image' | 'audio'}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Layout Item Renderer ─────────────────────────────────
// Renders a single layout item using getLayoutItemStyle for
// consistent styling with optional custom font sizes.

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

  // Image rendering
  if (item.style === 'media' || fieldType === 'image') {
    return (
      <div className="flex justify-center py-1">
        <img
          src={value}
          alt=""
          className="max-h-64 rounded-xl object-contain shadow-sm"
        />
      </div>
    )
  }

  // Audio rendering
  if (fieldType === 'audio') {
    return (
      <div className="flex justify-center py-1">
        <audio controls src={value} className="w-full max-w-sm" />
      </div>
    )
  }

  // Text rendering with style-aware classes + font size
  const { className, fontSize } = getLayoutItemStyle(item.style, item.font_size)

  return (
    <p
      className={className}
      style={{ fontSize: `${fontSize}px`, lineHeight: fontSize >= 32 ? 1.2 : 1.5 }}
    >
      {value}
    </p>
  )
}
