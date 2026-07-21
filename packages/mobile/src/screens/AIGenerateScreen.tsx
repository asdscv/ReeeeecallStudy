import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, FlatList, Alert, StyleSheet, TextInput as RNTextInput, Modal, Pressable, Image } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '@react-navigation/native'
import { Screen, TextInput, Button, Badge, ListCard, ScreenHeader } from '../components/ui'
import { useAIGenerateStore } from '@reeeeecall/shared/stores/ai-generate-store'
import { getAffordableCards, formatUsdMicro, type Affordable } from '@reeeeecall/shared/lib/ai/server-client'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import { useDecks } from '../hooks'
import { useTheme, palette } from '../theme'

// AI generation runs on our server key (metered free tier) — no provider/API
// key selection on the client.

const CONTENT_LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'zh-CN', label: '中文' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
]

type WizardStep = 'config' | 'generating' | 'review' | 'saving' | 'done' | 'error'

// Step keys map to i18n keys under `steps.*` (rendered via t(`steps.${key}`))
const FULL_STEPS = [
  { key: 'setup' },
  { key: 'template' },
  { key: 'deck' },
  { key: 'cards' },
  { key: 'done' },
] as const

const CARDS_ONLY_STEPS = [
  { key: 'setup' },
  { key: 'cards' },
  { key: 'done' },
] as const

function stepIndexFull(step: WizardStep): number {
  if (step === 'config') return 0
  if (step === 'generating' || step === 'saving') return 2
  if (step === 'review') return 3
  if (step === 'done') return 4
  return 0
}

function stepIndexCardsOnly(step: WizardStep): number {
  if (step === 'config') return 0
  if (step === 'generating' || step === 'saving' || step === 'review') return 1
  if (step === 'done') return 2
  return 0
}

function StepIndicator({ step, isCardsOnly }: { step: WizardStep; isCardsOnly: boolean }) {
  const { t } = useTranslation('ai-generate')
  const steps = isCardsOnly ? CARDS_ONLY_STEPS : FULL_STEPS
  const current = isCardsOnly ? stepIndexCardsOnly(step) : stepIndexFull(step)

  return (
    <View style={stepStyles.container}>
      {steps.map((s, i) => {
        const isCompleted = i < current
        const isActive = i === current
        return (
          <View key={s.key} style={stepStyles.stepWrapper}>
            {/* Connector line before circle (except first) */}
            {i > 0 && (
              <View
                style={[
                  stepStyles.line,
                  stepStyles.lineBefore,
                  { backgroundColor: isCompleted || isActive ? palette.blue[600] : palette.gray[300] },
                ]}
              />
            )}

            {/* Circle */}
            <View
              style={[
                stepStyles.circle,
                isCompleted && { backgroundColor: palette.green[500], borderColor: palette.green[500] },
                isActive && { backgroundColor: palette.blue[600], borderColor: palette.blue[600] },
                !isCompleted && !isActive && { backgroundColor: 'transparent', borderColor: palette.gray[300] },
              ]}
            >
              <Text
                style={[
                  stepStyles.circleText,
                  { color: isCompleted || isActive ? '#FFFFFF' : palette.gray[400] },
                ]}
              >
                {isCompleted ? '\u2713' : String(i + 1)}
              </Text>
            </View>

            {/* Connector line after circle (except last) */}
            {i < steps.length - 1 && (
              <View
                style={[
                  stepStyles.line,
                  stepStyles.lineAfter,
                  { backgroundColor: isCompleted ? palette.blue[600] : palette.gray[300] },
                ]}
              />
            )}

            {/* Label */}
            <Text
              style={[
                stepStyles.label,
                { color: isCompleted || isActive ? palette.gray[800] : palette.gray[400] },
                isActive && { fontWeight: '600' },
              ]}
            >
              {t(`steps.${s.key}`)}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

// ── Dropdown Picker Modal ──
function DropdownPicker<T extends string>({
  visible,
  onClose,
  options,
  selectedValue,
  onSelect,
}: {
  visible: boolean
  onClose: () => void
  options: { value: T; label: string }[]
  selectedValue: T
  onSelect: (value: T) => void
}) {
  const theme = useTheme()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={dropdownStyles.overlay} onPress={onClose}>
        <View style={[dropdownStyles.sheet, { backgroundColor: theme.colors.surfaceElevated }]}>
          <ScrollView bounces={false} style={dropdownStyles.scroll}>
            {options.map((opt) => {
              const isSelected = opt.value === selectedValue
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => { onSelect(opt.value); onClose() }}
                  style={[
                    dropdownStyles.option,
                    { borderBottomColor: theme.colors.border },
                    isSelected && { backgroundColor: theme.colors.primaryLight },
                  ]}
                >
                  <Text style={[theme.typography.body, { color: isSelected ? theme.colors.primary : theme.colors.text }]}>
                    {opt.label}
                  </Text>
                  {isSelected && <Text style={{ color: theme.colors.primary }}>{'\u2713'}</Text>}
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  )
}

export function AIGenerateScreen() {
  const { t } = useTranslation('ai-generate')
  const { t: tLimit } = useTranslation(['errors', 'settings'])
  const theme = useTheme()
  const navigation = useNavigation()
  const store = useAIGenerateStore()
  const { decks } = useDecks()
  const limit = useCardLimit()

  const [step, setStep] = useState<WizardStep>('config')

  // Config state
  const [topic, setTopic] = useState('')
  const [cardCount, setCardCount] = useState('10')
  const [contentLang, setContentLang] = useState('en-US')
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [showDeckPicker, setShowDeckPicker] = useState(false)

  // Image-recognition mode — cards_only only (needs the deck's template fields).
  const [imageMode, setImageMode] = useState<'topic' | 'image'>('topic')
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([])
  const MAX_IMAGES = 8
  const [affordable, setAffordable] = useState<Affordable | null>(null)
  const countTouched = useRef(false)   // once the user edits the count, stop auto-defaulting it

  // Image recognition works with OR without a deck: with a deck → add cards; without
  // a deck (new deck) → recognize the image into a whole new deck (kind='image_deck').
  const useImage = imageMode === 'image'

  // cards_only adds cards INTO an existing deck, so they must use that deck's
  // own template — never an arbitrary global templates[0], whose fields wouldn't
  // match the deck. A deck with no default_template_id can't accept AI cards yet.
  const selectedDeck = decks.find((d) => d.id === selectedDeckId)
  const cardsOnlyNeedsTemplate = !!selectedDeckId && !selectedDeck?.default_template_id

  useEffect(() => {
    getAffordableCards().then(setAffordable).catch(() => {})
  }, [])

  // Default the card count to today's REMAINING FREE cards (clamped to [1, 10]) so a default
  // generation never overshoots the free daily allowance. Applies once the server-authoritative
  // affordance loads and only until the user edits the count. (Parity with web ConfigStep.)
  useEffect(() => {
    if (affordable && !countTouched.current && !useImage) {
      setCardCount(String(Math.max(1, Math.min(10, affordable.free))))
    }
  }, [affordable, useImage])

  // Guard leaving mid-flow — the Android HARDWARE back button (and iOS swipe / any
  // goBack) would otherwise pop the whole wizard and silently discard the generated
  // cards, which cost real money in image mode. beforeRemove covers all back sources.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (step !== 'generating' && step !== 'review' && step !== 'saving') return
      e.preventDefault()
      Alert.alert(t('alert.discardTitle'), t('alert.discardMessage'), [
        { text: t('alert.cancel'), style: 'cancel' },
        { text: t('alert.discardConfirm'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ])
    })
    return unsub
  }, [navigation, step, t])

  // Clear stale uploaded images when the deck changes (prevents an accidental
  // paid re-generation with previously-picked photos).
  useEffect(() => { setImageDataUrls([]) }, [selectedDeckId])

  // Downscale one picked asset to a small JPEG data URL (≤1600px longer side,
  // recompressed) so a multi-MP phone photo clears the size cap. Null on failure.
  const downscaleAsset = async (asset: ImagePicker.ImagePickerAsset): Promise<string | null> => {
    try {
      const MAX_DIM = 1600
      const w = asset.width || 0
      const h = asset.height || 0
      const longer = Math.max(w, h)
      const actions: ImageManipulator.Action[] =
        longer > MAX_DIM ? [{ resize: w >= h ? { width: MAX_DIM } : { height: MAX_DIM } }] : []
      const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      })
      if (!out.base64) return null
      const dataUrl = `data:image/jpeg;base64,${out.base64}`
      return dataUrl.length > 6_500_000 ? null : dataUrl
    } catch {
      return null
    }
  }

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('alert.errorTitle'), t('alert.permissionDenied'))
      return
    }
    const room = MAX_IMAGES - imageDataUrls.length
    if (room <= 0) return
    // Multi-select up to the remaining room; each asset is downscaled + recompressed
    // ourselves (mirrors the web canvas ≤1600px path) and appended to the set.
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: room,
    })
    if (res.canceled || !res.assets?.length) return
    const urls = (await Promise.all(res.assets.slice(0, room).map(downscaleAsset))).filter(
      (u): u is string => !!u,
    )
    if (urls.length === 0) { Alert.alert(t('alert.errorTitle'), t('alert.selectImageError')); return }
    setImageDataUrls((prev) => [...prev, ...urls].slice(0, MAX_IMAGES))
  }

  const removeImage = (idx: number) =>
    setImageDataUrls((prev) => prev.filter((_, i) => i !== idx))

  const handleGenerate = async () => {
    // A cards_only deck with no template can't accept generated cards — block
    // before spending anything (the generate button is also disabled for this).
    if (cardsOnlyNeedsTemplate) {
      Alert.alert(t('alert.errorTitle'), t('alert.deckNoTemplate'))
      return
    }
    if (useImage) {
      if (imageDataUrls.length === 0) { Alert.alert(t('alert.errorTitle'), t('alert.imageRequired')); return }
    } else if (!topic.trim()) {
      Alert.alert(t('alert.errorTitle'), t('alert.enterTopic'))
      return
    }

    // Owned-card limit pre-flight (mig 116): don't spend AI cost/quota generating
    // cards that can't be saved. In image mode the count is model-decided, so only
    // block when there's NO room at all. Server also enforces at save.
    if (useImage ? limit.reached : limit.exceeds(parseInt(cardCount) || 10)) {
      Alert.alert(tLimit('errors:card.limitReached'), tLimit('settings:cardUsage.reached'))
      return
    }

    setStep('generating')
    try {
      // cards_only: use the deck's OWN template (guaranteed present by the guard
      // above). No templates[0] fallback — its fields wouldn't match the deck.
      const templateId = selectedDeck?.default_template_id ?? null

      store.setConfig({
        mode: selectedDeckId ? 'cards_only' : 'full',
        topic: topic.trim(),
        cardCount: parseInt(cardCount) || 10,
        useCustomHtml: false,
        contentLang,
        existingDeckId: selectedDeckId || null,
        existingTemplateId: selectedDeckId ? templateId : null,
      })

      if (useImage) {
        if (selectedDeckId) {
          await store.generateCardsFromImage(imageDataUrls)  // add cards to the deck
        } else {
          await store.generateDeckFromImage(imageDataUrls)   // image(s) → a whole new deck
        }
      } else {
        if (!selectedDeckId) {
          await store.generateTemplate()
          if (useAIGenerateStore.getState().currentStep === 'error') { setStep('error'); return }
          await store.generateDeck()
          if (useAIGenerateStore.getState().currentStep === 'error') { setStep('error'); return }
        }
        await store.generateCards()
      }
      // Check if the store ended in error (it catches internally and doesn't re-throw)
      if (useAIGenerateStore.getState().currentStep === 'error') {
        setStep('error')
        return
      }
      setStep('review')
    } catch (e) {
      setStep('error')
    }
  }

  const handleSave = async () => {
    setStep('saving')
    try {
      await store.saveAll()
      // saveAll catches internally + sets currentStep:'error' (it does NOT throw),
      // e.g. a card-limit (mig 116) rejection at save time — don't show "done 🎉".
      if (useAIGenerateStore.getState().currentStep === 'error') { setStep('error'); return }
      setStep('done')
    } catch {
      Alert.alert(t('alert.errorTitle'), t('alert.saveFailed'))
      setStep('review')
    }
  }

  const handleReset = () => {
    store.reset()
    setStep('config')
    setTopic('')
    setImageDataUrls([])
    setImageMode('topic')
  }

  // Retry after an error: clear only the store's results/error and return to the
  // config step, KEEPING the user's local config (topic / picked image / mode) so
  // they don't have to re-enter everything — especially painful after a paid image
  // error where handleReset would also drop the chosen image.
  const handleRetry = () => {
    store.retryFromConfig()
    setStep('config')
  }

  // ── Config Step ──
  if (step === 'config') {
    return (
      <Screen safeArea padding={false} keyboard testID="ai-generate-screen">
        <ScreenHeader title={t('title')} mode="drawer" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <StepIndicator step={step} isCardsOnly={!!selectedDeckId} />

          <Text style={[theme.typography.h1, { color: theme.colors.text }]}>{t('title')}</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            {t('subtitle')}
          </Text>

          {/* Generation Mode — matches web exactly */}
          <View style={[styles.labeledSection, { borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('mode.label')}</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity
                testID="ai-mode-full"
                onPress={() => setSelectedDeckId('')}
                style={[
                  styles.modeCard,
                  {
                    borderColor: !selectedDeckId ? theme.colors.primary : theme.colors.border,
                    backgroundColor: !selectedDeckId ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                  },
                ]}
              >
                <Text style={[theme.typography.bodySmall, {
                  color: !selectedDeckId ? theme.colors.primary : theme.colors.text,
                  fontWeight: !selectedDeckId ? '600' : '400',
                  textAlign: 'center',
                }]}>
                  {t('mode.full')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="ai-mode-cards"
                onPress={() => { if (decks.length > 0) setSelectedDeckId(decks[0].id) }}
                style={[
                  styles.modeCard,
                  {
                    borderColor: selectedDeckId ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selectedDeckId ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                  },
                ]}
              >
                <Text style={[theme.typography.bodySmall, {
                  color: selectedDeckId ? theme.colors.primary : theme.colors.text,
                  fontWeight: selectedDeckId ? '600' : '400',
                  textAlign: 'center',
                }]}>
                  {t('mode.cardsOnly')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* CONTENT SETTINGS — matches web: labeled bordered section */}
          <View style={styles.sectionLabelRow}>
            <Text style={[styles.sectionLabel, { color: palette.blue[600] }]}>{t('content.section')}</Text>
          </View>
          <View style={[styles.labeledSection, { borderColor: theme.colors.border }]}>
            {/* Input mode: topic vs image recognition (both flows — with a deck it
                adds cards, without a deck it builds a whole new deck from the image) */}
            {(
              <View style={styles.modeRow}>
                {(['topic', 'image'] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    testID={`ai-input-${m}`}
                    onPress={() => setImageMode(m)}
                    style={[styles.modeCard, {
                      borderColor: imageMode === m ? theme.colors.primary : theme.colors.border,
                      backgroundColor: imageMode === m ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                    }]}
                  >
                    <Text style={[theme.typography.bodySmall, {
                      color: imageMode === m ? theme.colors.primary : theme.colors.text,
                      fontWeight: imageMode === m ? '600' : '400',
                      textAlign: 'center',
                    }]}>
                      {t(m === 'topic' ? 'content.inputModeTopic' : 'content.inputModeImage')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: -4, marginBottom: 4 }]}>
              {t(useImage ? 'content.inputModeImageHint' : 'content.inputModeTopicHint')}
            </Text>

            {!useImage ? (
              <TextInput
                testID="ai-topic-input"
                label={t('content.topicLabel')}
                placeholder={t('content.topicPlaceholder')}
                value={topic}
                onChangeText={setTopic}
                multiline
                numberOfLines={3}
              />
            ) : (
              <View style={styles.section}>
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('content.imageUpload')}</Text>
                <TouchableOpacity
                  testID="ai-image-pick"
                  onPress={pickImage}
                  disabled={imageDataUrls.length >= MAX_IMAGES}
                  style={[styles.dropZone, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated, opacity: imageDataUrls.length >= MAX_IMAGES ? 0.5 : 1 }]}
                >
                  <Text style={{ fontSize: 30, marginBottom: 6 }}>🖼️</Text>
                  <Text style={[theme.typography.body, { color: theme.colors.primary, fontWeight: '600' }]}>
                    {imageDataUrls.length > 0
                      ? t('content.imageAddMore', { count: imageDataUrls.length, max: MAX_IMAGES })
                      : t('content.imageUpload')}
                  </Text>
                </TouchableOpacity>
                {imageDataUrls.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {imageDataUrls.map((src, i) => (
                      <View key={i} style={{ position: 'relative' }}>
                        <Image source={{ uri: src }} style={{ width: 88, height: 88, borderRadius: 8 }} resizeMode="cover" />
                        <TouchableOpacity
                          onPress={() => removeImage(i)}
                          hitSlop={8}
                          style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Text style={{ color: theme.colors.background, fontSize: 13, lineHeight: 15 }}>×</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>{t('content.imageHint')}</Text>
                <Text style={[theme.typography.caption, { color: palette.yellow[700] }]}>{t('content.imagePaidNotice')}</Text>
              </View>
            )}

            {/* Content Language — dropdown */}
            <View style={styles.section}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('content.contentLang')}</Text>
              <TouchableOpacity
                style={[styles.dropdown, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated }]}
                onPress={() => setShowLangPicker(true)}
              >
                <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>
                  {CONTENT_LANGS.find(l => l.code === contentLang)?.label ?? t('content.autoDetect')}
                </Text>
                <Text style={{ color: theme.colors.textTertiary }}>{'\u25BE'}</Text>
              </TouchableOpacity>
              <DropdownPicker
                visible={showLangPicker}
                onClose={() => setShowLangPicker(false)}
                options={CONTENT_LANGS.map(l => ({ value: l.code, label: l.label }))}
                selectedValue={contentLang}
                onSelect={setContentLang}
              />
            </View>

            {/* Number of cards — hidden in image mode (the model decides the count) */}
            {!useImage && (
            <View style={styles.section}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {t('content.cardCountLabel')}
              </Text>
              <TextInput
                testID="ai-card-count"
                value={cardCount}
                onChangeText={(v) => {
                  countTouched.current = true   // user set it → stop auto-defaulting to remaining-free
                  setCardCount(v.replace(/[^0-9]/g, ''))
                }}
                onBlur={() => {
                  const n = parseInt(cardCount) || 1
                  setCardCount(String(Math.min(Math.max(n, 1), 100)))
                }}
                keyboardType="number-pad"
                placeholder={t('content.cardCountPlaceholder')}
              />
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{t('content.cardCountHint')}</Text>
            </View>
            )}
          </View>

          {/* Deck selector — only when "Cards Only" mode */}
          {selectedDeckId && decks.length > 0 && (
            <>
              <View style={styles.sectionLabelRow}>
                <Text style={[styles.sectionLabel, { color: palette.blue[600] }]}>{t('deck.section')}</Text>
              </View>
              <View style={[styles.labeledSection, { borderColor: theme.colors.border }]}>
                <TouchableOpacity
                  style={[styles.dropdown, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated }]}
                  onPress={() => setShowDeckPicker(true)}
                >
                  <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>
                    {(() => { const d = decks.find(dk => dk.id === selectedDeckId); return d ? `${d.icon} ${d.name}` : t('deck.select') })()}
                  </Text>
                  <Text style={{ color: theme.colors.textTertiary }}>{'\u25BE'}</Text>
                </TouchableOpacity>
                <DropdownPicker
                  visible={showDeckPicker}
                  onClose={() => setShowDeckPicker(false)}
                  options={decks.map(d => ({ value: d.id, label: `${d.icon} ${d.name}` }))}
                  selectedValue={selectedDeckId}
                  onSelect={setSelectedDeckId}
                />
                {cardsOnlyNeedsTemplate && (
                  <Text style={[theme.typography.caption, { color: theme.colors.error, marginTop: 6 }]}>
                    {t('alert.deckNoTemplate')}
                  </Text>
                )}
              </View>
            </>
          )}

          {affordable && (() => {
            const balanceMicro = affordable.balanceMicroWon ?? 0
            const hasBalance = balanceMicro > 0
            const bal = () => t('wallet.balance', { amount: formatUsdMicro(balanceMicro), cards: affordable.paid })
            const text = !affordable.walletKnown
              ? t('wallet.unknown')
              : useImage
                ? (hasBalance ? bal() : t('wallet.imagePaid'))
                : affordable.free > 0 && hasBalance
                  ? `${t('wallet.freeOnly', { free: affordable.free })} · ${bal()}`
                  : affordable.free > 0
                    ? t('wallet.freeOnly', { free: affordable.free })
                    : hasBalance
                      ? bal()
                      : t('wallet.empty')
            return (
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                {text}
              </Text>
            )
          })()}
          {/* Pre-flight card-limit block: compute count vs remaining room BEFORE
              spending anything, so an over-limit generation can't start. */}
          {(() => {
            const overLimit = useImage ? limit.reached : limit.exceeds(parseInt(cardCount) || 10)
            if (!overLimit) return null
            return (
              <Text style={[theme.typography.caption, { color: theme.colors.error, textAlign: 'center', marginBottom: 4 }]}>
                {limit.reached
                  ? t('content.cardLimitReached')
                  : t('content.cardLimitExceeds', { available: limit.available })}
              </Text>
            )
          })()}
          <Button
            testID="ai-generate-button"
            title={t('generateButton')}
            onPress={handleGenerate}
            disabled={
              cardsOnlyNeedsTemplate ||
              (useImage ? imageDataUrls.length === 0 : !topic.trim()) ||
              (useImage ? limit.reached : limit.exceeds(parseInt(cardCount) || 10))
            }
          />
        </ScrollView>
      </Screen>
    )
  }

  // ── Generating / Saving Step ──
  if (step === 'generating' || step === 'saving') {
    return (
      <Screen testID="ai-generating-screen">
        <StepIndicator step={step} isCardsOnly={!!selectedDeckId} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 16 }]}>
            {step === 'generating' ? t('progress.generating') : t('progress.saving')}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            {store.progress.done}/{store.progress.total}
          </Text>
        </View>
      </Screen>
    )
  }

  // ── Review Step ──
  if (step === 'review') {
    const cards = store.generatedCards ?? []
    return (
      <Screen safeArea padding={false} keyboard testID="ai-review-screen">
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <StepIndicator step={step} isCardsOnly={!!selectedDeckId} />
        </View>
        <FlatList
          data={cards}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{t('review.title')}</Text>
              <Badge label={t('review.generatedCount', { count: cards.length })} variant="success" />
            </View>
          }
          renderItem={({ item, index }) => (
            <ReviewCard
              item={item}
              index={index}
              theme={theme}
              onUpdate={(fieldKey, value) => {
                const updated = [...cards]
                updated[index] = {
                  ...updated[index],
                  field_values: { ...updated[index].field_values, [fieldKey]: value },
                }
                store.editGeneratedCards(updated)
              }}
              onRemove={() => store.removeGeneratedCard(index)}
            />
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              <Button testID="ai-save-button" title={t('review.save', { count: cards.length })} onPress={handleSave} />
              <Button title={t('review.regenerate')} variant="outline" onPress={() => { handleReset(); }} />
            </View>
          }
        />
      </Screen>
    )
  }

  // ── Done Step ──
  if (step === 'done') {
    return (
      <Screen testID="ai-done-screen">
        <StepIndicator step={step} isCardsOnly={!!selectedDeckId} />
        <View style={styles.center}>
          <Text style={styles.doneEmoji}>🎉</Text>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{t('doneStep.title')}</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('doneStep.subtitle')}
          </Text>
          <View style={styles.doneActions}>
            <Button title={t('doneStep.generateMore')} onPress={handleReset} />
            <Button title={t('doneStep.done')} variant="secondary" onPress={() => navigation.goBack()} />
          </View>
        </View>
      </Screen>
    )
  }

  // ── Error Step ──
  return (
    <Screen testID="ai-error-screen">
      <StepIndicator step={step} isCardsOnly={!!selectedDeckId} />
      <View style={styles.center}>
        <Text style={styles.doneEmoji}>❌</Text>
        <Text style={[theme.typography.h3, { color: theme.colors.error }]}>{t('errorStep.title')}</Text>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
          {store.error ?? t('errorStep.default')}
        </Text>
        <View style={styles.doneActions}>
          <Button title={t('errorStep.retry')} onPress={handleRetry} />
          <Button title={t('errorStep.back')} variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </Screen>
  )
}

// ── Review Card with inline editing ──

function ReviewCard({
  item,
  index,
  theme,
  onUpdate,
  onRemove,
}: {
  item: { field_values: Record<string, string>; tags: string[] }
  index: number
  theme: ReturnType<typeof useTheme>
  onUpdate: (fieldKey: string, value: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('ai-generate')
  const [editing, setEditing] = useState(false)
  const entries = Object.entries(item.field_values)

  if (editing) {
    return (
      <View
        testID={`ai-card-edit-${index}`}
        style={[reviewStyles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.primary }]}
      >
        {entries.map(([key, val]) => (
          <View key={key} style={reviewStyles.fieldRow}>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{key}</Text>
            <RNTextInput
              value={String(val ?? '')}
              onChangeText={(v) => onUpdate(key, v)}
              style={[
                reviewStyles.input,
                theme.typography.bodySmall,
                { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.background },
              ]}
              multiline
            />
          </View>
        ))}
        <TouchableOpacity onPress={() => setEditing(false)} style={reviewStyles.doneBtn}>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>{t('review.cardDone')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <TouchableOpacity
      testID={`ai-card-${index}`}
      onPress={() => setEditing(true)}
      activeOpacity={0.7}
      style={[reviewStyles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
    >
      <View style={reviewStyles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
            {String(entries[0]?.[1] ?? '')}
          </Text>
          {entries[1] && (
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={2}>
              {String(entries[1][1])}
            </Text>
          )}
        </View>
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[theme.typography.caption, { color: palette.red[500] }]}>{t('review.remove')}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}

const dropdownStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  sheet: { borderRadius: 14, width: '100%', maxHeight: 360, overflow: 'hidden' },
  scroll: { flexGrow: 0 },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
})

const reviewStyles = StyleSheet.create({
  card: { borderRadius: 10, borderWidth: 1.5, padding: 12, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  fieldRow: { gap: 2 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minHeight: 36 },
  doneBtn: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 4 },
})

const stepStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  stepWrapper: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  label: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  line: {
    position: 'absolute',
    top: 13,
    height: 2,
  },
  lineBefore: {
    right: '50%',
    left: -4,
    marginRight: 14,
  },
  lineAfter: {
    left: '50%',
    right: -4,
    marginLeft: 14,
  },
})

const styles = StyleSheet.create({
  content: { gap: 16, paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 40 },
  topRow: { flexDirection: 'row' },
  // Labeled sections — matches web bordered cards with uppercase label
  sectionLabelRow: { marginBottom: -8 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  labeledSection: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 14 },
  // Mode
  modeRow: { flexDirection: 'row', gap: 10 },
  modeCard: { flex: 1, borderRadius: 12, borderWidth: 1.5, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  dropZone: { borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', paddingVertical: 28, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  // AI Provider
  providerCard: { borderRadius: 12, padding: 16, alignItems: 'center', gap: 10 },
  providerOption: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 } as const,
  settingsLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  // Dropdown
  dropdown: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5 },
  section: { gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  header: { gap: 8, paddingTop: 16, paddingBottom: 8 },
  footer: { gap: 10, marginTop: 16 },
  doneEmoji: { fontSize: 56, marginBottom: 16 },
  doneActions: { gap: 10, width: '100%', marginTop: 24 },
})
