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
  const [pointerOrigin, setPointerOrigin] = useState<{ x: number; y: number; t: number } | null>(null)
  const [swipeDelta, setSwipeDelta] = useState({ x: 0, y: 0 })
  const [preview, setPreview] = useState<SwipePreview | null>(null)
  const deltaRef = useRef({ x: 0, y: 0 })
  const prevCardIdRef = useRef(card.id)
  /** Direction commitment: 'none' → waiting, 'swipe' → JS handles, 'scroll' → browser handles */
  const committedRef = useRef<'none' | 'swipe' | 'scroll'>('none')
  /** Suppress click immediately after a successful swipe */
  const swipedRef = useRef(false)

  const swipeEnabled = inputSettings ? shouldEnableSwipe(inputSettings) : false

  // ── Reset ALL swipe state when card changes ───────────
  // This prevents overlay color from leaking to the next card
  useEffect(() => {
    if (prevCardIdRef.current !== card.id) {
      prevCardIdRef.current = card.id
      setPointerOrigin(null)
      setSwipeDelta({ x: 0, y: 0 })
      setPreview(null)
      deltaRef.current = { x: 0, y: 0 }
      committedRef.current = 'none'
    }
  }, [card.id])

  // Resolve card face content (handles mismatched keys, null templates, empty layouts)
  const frontFace = useMemo(
    () => resolveCardFaceContent(template, card, 'front'),
    [template, card],
  )
  const backFace = useMemo(
    () => resolveCardFaceContent(template, card, 'back'),
    [template, card],
  )

  // Custom HTML rendering decision (memoized)
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

  // ── Direction Commitment swipe handlers ─────────────
  // On pointerdown we record the origin but do NOT capture the pointer.
  // The first significant movement decides intent:
  //   horizontal → 'swipe' (capture pointer, JS handles)
  //   vertical   → 'scroll' (let browser scroll card content natively)
  // This lets mobile users scroll long card content while still swiping.

  function resetSwipeState() {
    setPointerOrigin(null)
    deltaRef.current = { x: 0, y: 0 }
    setSwipeDelta({ x: 0, y: 0 })
    setPreview(null)
    committedRef.current = 'none'
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!swipeEnabled || !isFlipped) return
    if ((e.target as HTMLElement).closest('button')) return
    // Record origin — do NOT setPointerCapture yet (would block native scroll)
    setPointerOrigin({ x: e.clientX, y: e.clientY, t: Date.now() })
    deltaRef.current = { x: 0, y: 0 }
    setSwipeDelta({ x: 0, y: 0 })
    setPreview(null)
    committedRef.current = 'none'
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!swipeEnabled || !pointerOrigin || !isFlipped || !inputSettings) return
    if (committedRef.current === 'scroll') return // browser is scrolling

    const dx = e.clientX - pointerOrigin.x
    const dy = e.clientY - pointerOrigin.y

    // ── Direction commitment phase ──────────────────
    if (committedRef.current === 'none') {
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (absDx < DEAD_ZONE && absDy < DEAD_ZONE) return // still in dead zone

      if (absDx >= absDy) {
        // Horizontal-dominant → swipe intent
        committedRef.current = 'swipe'
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
      } else {
        // Vertical-dominant → let browser scroll card content
        committedRef.current = 'scroll'
        return
      }
    }

    // ── Committed to swipe — track delta & preview ──
    deltaRef.current = { x: dx, y: dy }
    setSwipeDelta({ x: dx, y: dy })
    setPreview(previewSwipeAction(dx, dy, inputSettings.directions))
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (committedRef.current === 'swipe') {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
    }

    if (!swipeEnabled || !pointerOrigin || !isFlipped || !inputSettings || committedRef.current !== 'swipe') {
      resetSwipeState()
      return
    }

    const d = deltaRef.current
    const elapsed = Math.max(1, Date.now() - pointerOrigin.t)
    const distance = Math.sqrt(d.x * d.x + d.y * d.y)
    const velocity = distance / elapsed

    const result = resolveSwipeAction(d.x, d.y, inputSettings.directions, undefined, velocity)
    resetSwipeState()

    if (result) {
      // Suppress the click that follows pointerup so new card doesn't flip
      swipedRef.current = true
      setTimeout(() => { swipedRef.current = false }, 300)
      onSwipeRate?.(result.action)
    }
  }

  /** Browser took over (e.g. native scroll started) — clean up */
  function handlePointerCancel() {
    resetSwipeState()
  }

  // Computed card transform during active swipe drag (not during scroll)
  const isSwiping = pointerOrigin && committedRef.current === 'swipe'
  const dragTranslateX = isSwiping ? swipeDelta.x * DAMPEN : 0
  const dragTranslateY = isSwiping ? swipeDelta.y * DAMPEN : 0

  // Smart touch-action: allows card-content scrolling on the non-swipe axis
  const touchAction = computeTouchAction(
    inputSettings?.directions ?? { left: '', right: '', up: '', down: '' },
    swipeEnabled && isFlipped,
  )

  return (
    <div className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      <div className="w-full max-w-2xl">
        {/*
          mode="popLayout": old card is removed from flow immediately, exits
          as absolute overlay. New card enters simultaneously. This prevents
          the old card from showing its front face during a slow exit.
        */}
        <AnimatePresence mode="popLayout">
          <motion.div
            key={card.id}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="relative"
            style={{ perspective: '1000px' }}
          >
            <motion.div
              animate={{ rotateY: isFlipped ? 180 : 0 }}
              transition={{ duration: 0.4 }}
              style={{
                transformStyle: 'preserve-3d',
                transform: isSwiping
                  ? `rotateY(${isFlipped ? 180 : 0}deg) translate(${dragTranslateX}px, ${dragTranslateY}px)`
                  : undefined,
                touchAction,
                userSelect: isSwiping ? 'none' : 'auto',
              }}
              className="bg-white rounded-2xl shadow-lg border border-gray-200 min-h-[280px] sm:min-h-[400px] max-h-[70vh] cursor-pointer relative"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                if (swipedRef.current) return // suppress click after swipe
                onFlip()
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            >
              {/* Swipe color overlay — only during active swipe drag */}
              {preview && isSwiping && (
                <div
                  className="absolute inset-0 z-10 pointer-events-none rounded-2xl flex items-center justify-center"
                  style={{
                    backgroundColor: preview.color,
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <span
                    className="text-2xl font-bold text-white drop-shadow-md"
                    style={{ opacity: preview.progress }}
                  >
                    {preview.label}
                  </span>
                </div>
              )}

              {/*
                3D card flip using backface-visibility: hidden.
                Both faces are always in the DOM (absolute positioned).
                The browser's 3D engine hides whichever face is rotated away.
                This eliminates the flash caused by display:none/flex toggling.
              */}

              {/* Front Face — faces viewer when rotateY is 0 */}
              <div
                className="absolute inset-0 p-4 sm:p-8 lg:p-12 flex flex-col overflow-y-auto rounded-2xl"
                style={{ backfaceVisibility: 'hidden', overscrollBehavior: 'contain' }}
              >
                {frontRender.mode !== 'custom' && (
                  <>
                    <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500 rounded-t-2xl" />
                    <div className="absolute top-2 right-3 text-[10px] font-semibold text-blue-400 tracking-wider uppercase">
                      {t('card.front')}
                    </div>
                  </>
                )}
                <div className="flex-1 flex flex-col items-center justify-center">
                  {frontRender.mode === 'custom' ? (
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
                  )}
                </div>
                <div className="text-xs sm:text-sm text-gray-400 text-center pt-2 sm:pt-4 shrink-0">
                  {t('card.tapToFlip')}
                </div>
              </div>

              {/* Back Face — faces viewer when parent rotateY is 180 */}
              <div
                className="absolute inset-0 p-4 sm:p-8 lg:p-12 flex flex-col overflow-y-auto rounded-2xl"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  overscrollBehavior: 'contain',
                }}
              >
                {backRender.mode !== 'custom' && (
                  <>
                    <div className="absolute top-0 left-0 right-0 h-1 bg-teal-500 rounded-t-2xl" />
                    <div className="absolute top-2 left-3 text-[10px] font-semibold text-teal-400 tracking-wider uppercase">
                      {t('card.back')}
                    </div>
                  </>
                )}
                <div className="flex-1 flex flex-col items-center justify-center">
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
                </div>

                {swipeEnabled && inputSettings && (
                  <SwipeGuide
                    directions={inputSettings.directions}
                    visible={isFlipped && !isSwiping}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>

        {/* Swipe hint (shown when flipped + swipe mode) */}
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
