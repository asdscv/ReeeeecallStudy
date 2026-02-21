import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { Volume2 } from 'lucide-react'
import { renderCardFace } from '../../lib/card-renderer'
import { resolveCardFaceContent } from '../../lib/card-face-resolver'
import { getLayoutItemStyle } from '../../lib/layout-styles'
import { speak, type TTSFieldInfo } from '../../lib/tts'
import {
  shouldEnableSwipe,
  resolveSwipeAction,
  previewSwipeAction,
  buildSwipeHintText,
  computeTouchAction,
  DEAD_ZONE,
  type StudyInputSettings,
  type SwipePreview,
} from '../../lib/study-input-settings'
import { SwipeGuide } from './SwipeGuide'
import type { Card, CardTemplate, LayoutItem } from '../../types/database'

interface StudyCardProps {
  card: Card
  template: CardTemplate | null
  isFlipped: boolean
  onFlip: () => void
  frontTTSFields?: TTSFieldInfo[]
  backTTSFields?: TTSFieldInfo[]
  onSwipeRate?: (rating: string) => void
  inputSettings?: StudyInputSettings | null
}

/** Card follows finger at 60% of actual movement (higher = more responsive) */
const DAMPEN = 0.6

export function StudyCard({
  card,
  template,
  isFlipped,
  onFlip,
  frontTTSFields,
  backTTSFields,
  onSwipeRate,
  inputSettings,
}: StudyCardProps) {
  const { t } = useTranslation('study')

  // ── Render-affecting state ──
  const [swipeDelta, setSwipeDelta] = useState({ x: 0, y: 0 })
  const [preview, setPreview] = useState<SwipePreview | null>(null)
  const [isSwiping, setIsSwiping] = useState(false)

  // 2D flip: which side is currently displayed + fade animation
  const [displaySide, setDisplaySide] = useState<'front' | 'back'>(isFlipped ? 'back' : 'front')
  const [isFading, setIsFading] = useState(false)

  // ── Refs (no re-renders) ──
  const pointerOriginRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const deltaRef = useRef({ x: 0, y: 0 })
  const prevCardIdRef = useRef(card.id)
  const committedRef = useRef<'none' | 'swipe' | 'scroll'>('none')
  const swipedRef = useRef(false)

  const swipeEnabled = inputSettings ? shouldEnableSwipe(inputSettings) : false

  // ── 2D flip animation ──────────────────────────────────
  // No CSS 3D at all. Fade out → swap content → fade in.
  // Card body has ZERO transforms when idle → iOS momentum scroll works.
  useEffect(() => {
    const target = isFlipped ? 'back' : 'front'
    if (displaySide !== target && !isFading) {
      setIsFading(true)
      const timer = setTimeout(() => {
        setDisplaySide(target)
        setIsFading(false)
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [isFlipped, displaySide, isFading])

  // ── Reset ALL state when card changes ──────────────────
  useEffect(() => {
    if (prevCardIdRef.current !== card.id) {
      prevCardIdRef.current = card.id
      pointerOriginRef.current = null
      deltaRef.current = { x: 0, y: 0 }
      committedRef.current = 'none'
      setSwipeDelta({ x: 0, y: 0 })
      setPreview(null)
      setIsSwiping(false)
      setDisplaySide('front')
      setIsFading(false)
    }
  }, [card.id])

  // Resolve card face content
  const frontFace = useMemo(
    () => resolveCardFaceContent(template, card, 'front'),
    [template, card],
  )
  const backFace = useMemo(
    () => resolveCardFaceContent(template, card, 'back'),
    [template, card],
  )

  // Custom HTML rendering
  const frontRender = useMemo(
    () => renderCardFace(template, card, 'front'),
    [template, card],
  )
  const backRender = useMemo(
    () => renderCardFace(template, card, 'back'),
    [template, card],
  )

  // Swipe hint text
  const hintText = useMemo(
    () => (inputSettings && swipeEnabled ? buildSwipeHintText(inputSettings.directions) : ''),
    [inputSettings, swipeEnabled],
  )

  // ── Direction Commitment swipe handlers ─────────────────
  function resetSwipeState() {
    pointerOriginRef.current = null
    deltaRef.current = { x: 0, y: 0 }
    committedRef.current = 'none'
    setSwipeDelta({ x: 0, y: 0 })
    setPreview(null)
    setIsSwiping(false)
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!swipeEnabled || !isFlipped) return
    if ((e.target as HTMLElement).closest('button')) return
    pointerOriginRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    deltaRef.current = { x: 0, y: 0 }
    committedRef.current = 'none'
  }

  function handlePointerMove(e: React.PointerEvent) {
    const origin = pointerOriginRef.current
    if (!swipeEnabled || !origin || !isFlipped || !inputSettings) return
    if (committedRef.current === 'scroll') return

    const dx = e.clientX - origin.x
    const dy = e.clientY - origin.y

    if (committedRef.current === 'none') {
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (absDx < DEAD_ZONE && absDy < DEAD_ZONE) return

      if (absDx >= absDy) {
        committedRef.current = 'swipe'
        setIsSwiping(true)
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
      } else {
        committedRef.current = 'scroll'
        return
      }
    }

    deltaRef.current = { x: dx, y: dy }
    setSwipeDelta({ x: dx, y: dy })
    setPreview(previewSwipeAction(dx, dy, inputSettings.directions))
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (committedRef.current === 'swipe') {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
    }

    const origin = pointerOriginRef.current
    if (!swipeEnabled || !origin || !isFlipped || !inputSettings || committedRef.current !== 'swipe') {
      resetSwipeState()
      return
    }

    const d = deltaRef.current
    const elapsed = Math.max(1, Date.now() - origin.t)
    const distance = Math.sqrt(d.x * d.x + d.y * d.y)
    const velocity = distance / elapsed

    const result = resolveSwipeAction(d.x, d.y, inputSettings.directions, undefined, velocity)
    resetSwipeState()

    if (result) {
      swipedRef.current = true
      setTimeout(() => { swipedRef.current = false }, 300)
      onSwipeRate?.(result.action)
    }
  }

  function handlePointerCancel() {
    resetSwipeState()
  }

  // Computed swipe drag offset
  const dragTranslateX = isSwiping ? swipeDelta.x * DAMPEN : 0
  const dragTranslateY = isSwiping ? swipeDelta.y * DAMPEN : 0

  // Touch-action for swipe vs scroll
  const touchAction = computeTouchAction(
    inputSettings?.directions ?? { left: '', right: '', up: '', down: '' },
    swipeEnabled && isFlipped,
  )

  // ── Card body style: ZERO 3D — only 2D transforms when needed ──
  const cardStyle: React.CSSProperties = {
    touchAction,
    userSelect: isSwiping ? 'none' : 'auto',
    WebkitUserSelect: isSwiping ? 'none' : 'auto',
    WebkitTouchCallout: 'none',
  }

  // Only apply transform during active swipe or fade (idle = NO transform)
  if (isSwiping) {
    cardStyle.transform = `translate(${dragTranslateX}px, ${dragTranslateY}px)`
  } else if (isFading) {
    cardStyle.opacity = 0
    cardStyle.transform = 'scale(0.97)'
  }

  // Transition only for fade animation, not during swipe
  if (!isSwiping) {
    cardStyle.transition = 'opacity 0.15s ease-in-out, transform 0.15s ease-in-out'
  }

  return (
    <div className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      <div className="w-full max-w-2xl">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={card.id}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="relative"
          >
            {/*
              Card body — NO perspective, NO preserve-3d, NO rotateY.
              Pure 2D div. Scroll container lives in a normal 2D context.
              iOS Safari momentum scroll works natively.
            */}
            <div
              className="bg-white rounded-2xl shadow-lg border border-gray-200 min-h-[280px] sm:min-h-[400px] max-h-[70vh] cursor-pointer relative"
              style={cardStyle}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                if (swipedRef.current) return
                onFlip()
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            >
              {/* Swipe color overlay */}
              {preview && isSwiping && (
                <div
                  className="absolute inset-0 z-10 pointer-events-none rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: preview.color }}
                >
                  <span
                    className="text-2xl font-bold text-white drop-shadow-md"
                    style={{ opacity: preview.progress }}
                  >
                    {preview.label}
                  </span>
                </div>
              )}

              {/* Decorative header */}
              {frontRender.mode !== 'custom' && displaySide === 'front' && (
                <>
                  <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500 rounded-t-2xl z-10" />
                  <div className="absolute top-2 right-3 text-[10px] font-semibold text-blue-400 tracking-wider uppercase z-10">
                    {t('card.front')}
                  </div>
                </>
              )}
              {backRender.mode !== 'custom' && displaySide === 'back' && (
                <>
                  <div className="absolute top-0 left-0 right-0 h-1 bg-teal-500 rounded-t-2xl z-10" />
                  <div className="absolute top-2 left-3 text-[10px] font-semibold text-teal-400 tracking-wider uppercase z-10">
                    {t('card.back')}
                  </div>
                </>
              )}

              {/* Scroll layer — pure 2D, no 3D ancestor */}
              <div
                className="h-full p-4 sm:p-8 lg:p-12 flex flex-col overflow-y-auto"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <div className="flex-1 flex flex-col items-center justify-center">
                  {displaySide === 'front' ? (
                    // ── Front content ──
                    frontRender.mode === 'custom' ? (
                      <div
                        className="prose prose-sm max-w-none text-center"
                        dangerouslySetInnerHTML={{ __html: frontRender.html }}
                      />
                    ) : frontFace.effectiveLayout.length > 0 ? (
                      <CardFaceLayout
                        layout={frontFace.effectiveLayout}
                        fieldValues={frontFace.fieldValues}
                        fields={frontFace.fields}
                        ttsFields={frontTTSFields}
                        t={t}
                      />
                    ) : (
                      <div className="text-3xl sm:text-5xl font-bold text-gray-900 text-center tracking-tight break-words">
                        {frontFace.fallbackValue}
                      </div>
                    )
                  ) : (
                    // ── Back content ──
                    <>
                      {backRender.mode === 'custom' ? (
                        <div
                          className="prose prose-sm max-w-none text-center"
                          dangerouslySetInnerHTML={{ __html: backRender.html }}
                        />
                      ) : (
                        <>
                          {frontFace.primaryValue && (
                            <div className="text-sm sm:text-base text-gray-300 mb-3 sm:mb-6 tracking-wide">
                              {frontFace.primaryValue}
                            </div>
                          )}
                          {backFace.effectiveLayout.length > 0 ? (
                            <CardFaceLayout
                              layout={backFace.effectiveLayout}
                              fieldValues={backFace.fieldValues}
                              fields={backFace.fields}
                              ttsFields={backTTSFields}
                              t={t}
                            />
                          ) : (
                            <div className="text-2xl sm:text-4xl font-bold text-gray-900 text-center tracking-tight break-words">
                              {backFace.fallbackValue}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Tap-to-flip hint (front face) */}
                {displaySide === 'front' && (
                  <div className="text-xs sm:text-sm text-gray-400 text-center pt-2 sm:pt-4 shrink-0">
                    {t('card.tapToFlip')}
                  </div>
                )}

                {/* Swipe guide (back face, swipe mode) */}
                {displaySide === 'back' && swipeEnabled && inputSettings && (
                  <SwipeGuide
                    directions={inputSettings.directions}
                    visible={isFlipped && !isSwiping}
                  />
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Swipe hint text */}
        {isFlipped && swipeEnabled && hintText && (
          <div className="text-center mt-4 text-gray-400 text-sm" data-testid="swipe-hint">
            {hintText}
          </div>
        )}

        {/* Flip hint */}
        {!isFlipped && (
          <div className="text-center mt-3 sm:mt-6 text-gray-400 text-xs sm:text-sm">
            {t('card.tapToReveal')}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Card Face Layout ─────────────────────────────────────

function CardFaceLayout({
  layout,
  fieldValues,
  fields,
  ttsFields,
  t,
}: {
  layout: LayoutItem[]
  fieldValues: Record<string, string>
  fields: { key: string; type: string }[]
  ttsFields?: TTSFieldInfo[]
  t: (key: string) => string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 sm:gap-3 w-full max-w-lg text-center">
      {layout.map((item, idx) => {
        const value = fieldValues[item.field_key] ?? ''
        const fieldType = fields.find(f => f.key === item.field_key)?.type ?? 'text'
        const ttsInfo = ttsFields?.find(t => t.fieldKey === item.field_key)

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
            <div className={ttsInfo ? 'flex items-center gap-1 justify-center' : ''}>
              {ttsInfo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    speak(ttsInfo.text, ttsInfo.lang)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-2.5 -m-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors shrink-0"
                  title={t('card.ttsPlay')}
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              )}
              <LayoutItemRenderer
                item={item}
                value={value}
                fieldType={fieldType as 'text' | 'image' | 'audio'}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Layout Item Renderer ─────────────────────────────────

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
      <div className="flex justify-center py-1">
        <img
          src={value}
          alt=""
          className="max-h-40 sm:max-h-64 rounded-xl object-contain shadow-sm"
        />
      </div>
    )
  }

  if (fieldType === 'audio') {
    return (
      <div className="flex justify-center py-1">
        <audio controls src={value} className="w-full max-w-sm" />
      </div>
    )
  }

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
