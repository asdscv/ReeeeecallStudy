import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, FlatList, Alert, StyleSheet, TextInput as RNTextInput, Modal, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation } from '@react-navigation/native'
import { Screen, TextInput, Button, Badge, ListCard, ScreenHeader } from '../components/ui'
import { useAIGenerateStore } from '@reeeeecall/shared/stores/ai-generate-store'
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
  const theme = useTheme()
  const navigation = useNavigation()
  const store = useAIGenerateStore()
  const { decks, templates } = useDecks()

  const [step, setStep] = useState<WizardStep>('config')

  // Config state
  const [topic, setTopic] = useState('')
  const [cardCount, setCardCount] = useState('10')
  const [contentLang, setContentLang] = useState('en-US')
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [showDeckPicker, setShowDeckPicker] = useState(false)

  const handleGenerate = async () => {
    if (!topic.trim()) {
      Alert.alert(t('alert.errorTitle'), t('alert.enterTopic'))
      return
    }

    setStep('generating')
    try {
      // Use the shared store's generation flow
      const deck = decks.find((d) => d.id === selectedDeckId)
      const templateId = deck?.default_template_id ?? templates[0]?.id ?? ''

      store.setConfig({
        mode: selectedDeckId ? 'cards_only' : 'full',
        topic: topic.trim(),
        cardCount: parseInt(cardCount) || 10,
        useCustomHtml: false,
        contentLang,
        existingDeckId: selectedDeckId || null,
        existingTemplateId: selectedDeckId ? templateId : null,
      })

      if (!selectedDeckId) {
        await store.generateTemplate()
        if (useAIGenerateStore.getState().currentStep === 'error') { setStep('error'); return }
        await store.generateDeck()
        if (useAIGenerateStore.getState().currentStep === 'error') { setStep('error'); return }
      }
      await store.generateCards()
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
            <TextInput
              testID="ai-topic-input"
              label={t('content.topicLabel')}
              placeholder={t('content.topicPlaceholder')}
              value={topic}
              onChangeText={setTopic}
              multiline
              numberOfLines={3}
            />

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

            {/* Number of cards */}
            <View style={styles.section}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {t('content.cardCountLabel')}
              </Text>
              <TextInput
                testID="ai-card-count"
                value={cardCount}
                onChangeText={(v) => {
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
              </View>
            </>
          )}

          <Button
            testID="ai-generate-button"
            title={t('generateButton')}
            onPress={handleGenerate}
            disabled={!topic.trim()}
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
          <Button title={t('errorStep.retry')} onPress={handleReset} />
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
  modeCard: { flex: 1, borderRadius: 10, borderWidth: 1.5, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
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
