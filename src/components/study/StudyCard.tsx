import { useMemo, useRef, useState } from 'react'
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
  type StudyInputSettings,
  type SwipePreview,
} from '../../lib/study-input-settings'
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

const DAMPEN = 0.3

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
  const [pointerOrigin, setPointerOrigin] = useState<{ x: number; y: number } | null>(null)
  const [swipeDelta, setSwipeDelta] = useState({ x: 0, y: 0 })
  const [preview, setPreview] = useState<SwipePreview | null>(null)
  const deltaRef = useRef({ x: 0, y: 0 })

  const swipeEnabled = inputSettings ? shouldEnableSwipe(inputSettings) : false

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

  // Pointer-based swipe handlers (works on both mouse and touch)
  function handlePointerDown(e: React.PointerEvent) {
    if (!swipeEnabled || !isFlipped) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    setPointerOrigin({ x: e.clientX, y: e.clientY })
    deltaRef.current = { x: 0, y: 0 }
    setSwipeDelta({ x: 0, y: 0 })
    setPreview(null)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!swipeEnabled || !pointerOrigin || !isFlipped || !inputSettings) return
    const dx = e.clientX - pointerOrigin.x
    const dy = e.clientY - pointerOrigin.y
    deltaRef.current = { x: dx, y: dy }
    setSwipeDelta({ x: dx, y: dy })
    setPreview(previewSwipeAction(dx, dy, inputSettings.directions))
  }

  function handlePointerUp(e: React.PointerEvent) {
    const el = e.currentTarget as HTMLElement
    el.releasePointerCapture(e.pointerId)

    if (!swipeEnabled || !pointerOrigin || !isFlipped || !inputSettings) {
      setPointerOrigin(null)
      deltaRef.current = { x: 0, y: 0 }
      setSwipeDelta({ x: 0, y: 0 })
      setPreview(null)
      return
    }

    const d = deltaRef.current
    const result = resolveSwipeAction(d.x, d.y, inputSettings.directions)
    if (result) {
      onSwipeRate?.(result.action)
    }

    setPointerOrigin(null)
    deltaRef.current = { x: 0, y: 0 }
    setSwipeDelta({ x: 0, y: 0 })
    setPreview(null)
  }

  // Computed card transform during drag
  const dragTranslateX = pointerOrigin ? swipeDelta.x * DAMPEN : 0
  const dragTranslateY = pointerOrigin ? swipeDelta.y * DAMPEN : 0

  return (
    <div className="flex-1 flex items-center justify-center p-2 sm:p-4">
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
              style={{
                transformStyle: 'preserve-3d',
                transform: pointerOrigin
                  ? `rotateY(${isFlipped ? 180 : 0}deg) translate(${dragTranslateX}px, ${dragTranslateY}px)`
                  : undefined,
                touchAction: (swipeEnabled && isFlipped) ? 'none' : 'auto',
                userSelect: pointerOrigin ? 'none' : 'auto',
              }}
              className="bg-white rounded-2xl shadow-lg border border-gray-200 min-h-[280px] sm:min-h-[400px] max-h-[70vh] cursor-pointer relative overflow-hidden"
              onClick={onFlip}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {/* Swipe color overlay */}
              {preview && pointerOrigin && (
                <div
                  className="absolute inset-0 z-10 pointer-events-none rounded-2xl flex items-center justify-center"
                  style={{
                    backgroundColor: preview.color,
                    // Flip the overlay so it appears correctly on the back face
                    transform: isFlipped ? 'rotateY(180deg)' : undefined,
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

              {/* Front Face */}
              <div
                className="p-4 sm:p-8 lg:p-12 flex flex-col overflow-y-auto"
                style={{ display: isFlipped ? 'none' : 'flex', minHeight: 'inherit', maxHeight: 'inherit' }}
              >
                {/* Content — vertically & horizontally centered */}
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
                {/* Hint — pinned to bottom */}
                <div className="text-xs sm:text-sm text-gray-400 text-center pt-2 sm:pt-4 shrink-0">
                  {t('card.tapToFlip')}
                </div>
              </div>

              {/* Back Face */}
              <div
                className="p-4 sm:p-8 lg:p-12 flex flex-col overflow-y-auto"
                style={{
                  transform: 'rotateY(180deg)',
                  display: isFlipped ? 'flex' : 'none',
                  minHeight: 'inherit',
                  maxHeight: 'inherit',
                }}
              >
                {/* Content — vertically & horizontally centered */}
                <div className="flex-1 flex flex-col items-center justify-center">
                  {backRender.mode === 'custom' ? (
                    <div
                      className="prose prose-sm max-w-none text-center"
                      dangerouslySetInnerHTML={{ __html: backRender.html }}
                    />
                  ) : (
                    <>
                      {/* Small reminder of front value */}
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
// Renders a list of layout items with proper visual hierarchy,
// spacing, and separators between different style groups.

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
            <div className={ttsInfo ? 'flex items-center gap-1 justify-center' : ''}>
              {ttsInfo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    speak(ttsInfo.text, ttsInfo.lang)
                  }}
                  className="p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors shrink-0"
                  title={t('card.ttsPlay')}
                >
                  <Volume2 className="w-4 h-4" />
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
          className="max-h-40 sm:max-h-64 rounded-xl object-contain shadow-sm"
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
