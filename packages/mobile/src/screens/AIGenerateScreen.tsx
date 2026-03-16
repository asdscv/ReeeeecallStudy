import { useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, FlatList, Alert, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, TextInput, Button, Badge, ListCard } from '../components/ui'
import { useAIGenerateStore } from '@reeeeecall/shared/stores/ai-generate-store'
import { useDecks } from '../hooks'
import { useTheme } from '../theme'

const CONTENT_LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'zh-CN', label: '中文' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
]

type WizardStep = 'config' | 'generating' | 'review' | 'saving' | 'done' | 'error'

export function AIGenerateScreen() {
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

  const handleGenerate = async () => {
    if (!topic.trim()) {
      Alert.alert('Error', 'Please enter a topic')
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
        await store.generateDeck()
      }
      await store.generateCards()
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
      Alert.alert('Error', 'Failed to save generated cards')
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
      <Screen scroll keyboard testID="ai-generate-screen">
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Button title="← Back" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />
          </View>

          <Text style={[theme.typography.h1, { color: theme.colors.text }]}>AI Generate</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            Describe a topic and AI will create flashcards for you
          </Text>

          <TextInput
            testID="ai-topic-input"
            label="Topic"
            placeholder="e.g. Spanish travel phrases, React hooks, Human anatomy..."
            value={topic}
            onChangeText={setTopic}
            multiline
            numberOfLines={3}
          />

          <TextInput
            testID="ai-card-count"
            label="Number of Cards"
            value={cardCount}
            onChangeText={setCardCount}
            keyboardType="number-pad"
            hint="1-100 cards"
          />

          {/* Content Language */}
          <View style={styles.section}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Content Language</Text>
            <View style={styles.chipRow}>
              {CONTENT_LANGS.map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  testID={`ai-lang-${lang.code}`}
                  onPress={() => setContentLang(lang.code)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: contentLang === lang.code ? theme.colors.primaryLight : theme.colors.surface,
                      borderColor: contentLang === lang.code ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[
                    theme.typography.bodySmall,
                    { color: contentLang === lang.code ? theme.colors.primary : theme.colors.text },
                  ]}>
                    {lang.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Add to existing deck (optional) */}
          {decks.length > 0 && (
            <View style={styles.section}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                Add to Existing Deck (optional)
              </Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  onPress={() => setSelectedDeckId('')}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: !selectedDeckId ? theme.colors.primaryLight : theme.colors.surface,
                      borderColor: !selectedDeckId ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[theme.typography.bodySmall, { color: !selectedDeckId ? theme.colors.primary : theme.colors.text }]}>
                    New Deck
                  </Text>
                </TouchableOpacity>
                {decks.slice(0, 5).map((deck) => (
                  <TouchableOpacity
                    key={deck.id}
                    onPress={() => setSelectedDeckId(deck.id)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selectedDeckId === deck.id ? theme.colors.primaryLight : theme.colors.surface,
                        borderColor: selectedDeckId === deck.id ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[theme.typography.bodySmall, { color: selectedDeckId === deck.id ? theme.colors.primary : theme.colors.text }]}>
                      {deck.icon} {deck.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <Button
            testID="ai-generate-button"
            title="Generate Cards"
            onPress={handleGenerate}
            disabled={!topic.trim()}
          />
        </View>
      </Screen>
    )
  }

  // ── Generating / Saving Step ──
  if (step === 'generating' || step === 'saving') {
    return (
      <Screen testID="ai-generating-screen">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 16 }]}>
            {step === 'generating' ? 'Generating cards...' : 'Saving cards...'}
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
      <Screen safeArea padding={false} testID="ai-review-screen">
        <FlatList
          data={cards}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Review Cards</Text>
              <Badge label={`${cards.length} cards generated`} variant="success" />
            </View>
          }
          renderItem={({ item, index }) => {
            const values = Object.values(item.field_values ?? item)
            return (
              <ListCard testID={`ai-card-${index}`}>
                <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                  {values[0] ?? ''}
                </Text>
                {values[1] && (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                    {String(values[1])}
                  </Text>
                )}
              </ListCard>
            )
          }}
          ListFooterComponent={
            <View style={styles.footer}>
              <Button testID="ai-save-button" title={`Save ${cards.length} Cards`} onPress={handleSave} />
              <Button title="Regenerate" variant="outline" onPress={() => { handleReset(); }} />
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
        <View style={styles.center}>
          <Text style={styles.doneEmoji}>🎉</Text>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Cards Created!</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            Your AI-generated flashcards are ready to study.
          </Text>
          <View style={styles.doneActions}>
            <Button title="Generate More" onPress={handleReset} />
            <Button title="Done" variant="secondary" onPress={() => navigation.goBack()} />
          </View>
        </View>
      </Screen>
    )
  }

  // ── Error Step ──
  return (
    <Screen testID="ai-error-screen">
      <View style={styles.center}>
        <Text style={styles.doneEmoji}>❌</Text>
        <Text style={[theme.typography.h3, { color: theme.colors.error }]}>Generation Failed</Text>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
          {store.error ?? 'An error occurred during generation'}
        </Text>
        <View style={styles.doneActions}>
          <Button title="Try Again" onPress={handleReset} />
          <Button title="Go Back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },
  topRow: { flexDirection: 'row' },
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
