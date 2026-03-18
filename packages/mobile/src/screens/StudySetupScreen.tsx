import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, Switch, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, TextInput } from '../components/ui'
import { testProps } from '../utils/testProps'
import { useDecks } from '../hooks/useDecks'
import { useStudy } from '../hooks/useStudy'
import { useTheme, palette } from '../theme'
import type { StudyStackParamList } from '../navigation/types'
import type { StudyMode } from '@reeeeecall/shared/types/database'

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySetup'>
type Route = RouteProp<StudyStackParamList, 'StudySetup'>

/**
 * Study mode options — matches web STUDY_MODE_OPTIONS.
 * Each option is a full-width card with emoji, label, description.
 */
const MODES: { mode: StudyMode; emoji: string; label: string; desc: string; detail: string }[] = [
  { mode: 'srs', emoji: '🧠', label: 'SRS Review', desc: 'Spaced repetition for long-term memory', detail: 'Cards are scheduled based on your performance' },
  { mode: 'sequential_review', emoji: '📖', label: 'Sequential', desc: 'In order, mixing new + review cards', detail: 'Go through cards sequentially from where you left off' },
  { mode: 'random', emoji: '🎲', label: 'Random', desc: 'Shuffled cards', detail: 'Cards are randomly selected from the deck' },
  { mode: 'cramming', emoji: '⚡', label: 'Cramming', desc: 'Rapid-fire until mastered', detail: 'Missed cards return until you get them all right' },
  { mode: 'by_date', emoji: '📅', label: 'By Date', desc: 'Study cards by upload date', detail: 'Select a date to study cards added on that day' },
]

const CRAMMING_FILTERS = [
  { value: 'all', label: 'All Cards' },
  { value: 'weak', label: 'Weak Cards' },
  { value: 'due_soon', label: 'Due Soon' },
] as const

const TIME_LIMITS = [
  { value: null, label: 'No Limit' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
] as const

export function StudySetupScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const preselectedDeckId = route.params?.deckId

  const { decks, stats, refresh } = useDecks()
  const { startSession, phase } = useStudy()

  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  const [selectedDeckId, setSelectedDeckId] = useState(preselectedDeckId ?? '')
  const [selectedMode, setSelectedMode] = useState<StudyMode>('srs')
  const [batchSize, setBatchSize] = useState('20')

  // Cramming settings
  const [crammingFilter, setCrammingFilter] = useState<string>('all')
  const [crammingTimeLimit, setCrammingTimeLimit] = useState<number | null>(null)
  const [crammingShuffle, setCrammingShuffle] = useState(true)

  const selectedDeck = decks.find((d) => d.id === selectedDeckId)
  const deckStats = stats.find((s) => s.deck_id === selectedDeckId)
  const cardCount = deckStats?.total_cards ?? 0
  const isLoading = phase === 'loading'

  // Batch size is configurable for srs, sequential_review, random, by_date (not cramming)
  const showBatchSize = selectedMode !== 'cramming'

  const handleStart = async () => {
    if (!selectedDeckId) {
      Alert.alert('Select a Deck', 'Please choose a deck to study')
      return
    }
    const size = parseInt(batchSize) || 20
    try {
      await startSession(selectedDeckId, selectedMode, size)
      navigation.navigate('StudySession')
    } catch (e) {
      Alert.alert('Error', 'Failed to start study session')
    }
  }

  return (
    <Screen scroll testID="study-setup-screen">
      <View style={styles.content}>
        {/* Back button — matches web */}
        {selectedDeck && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>← {selectedDeck.name}</Text>
          </TouchableOpacity>
        )}

        <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Study Setup</Text>

        {selectedDeck && (
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            {selectedDeck.icon} {selectedDeck.name} · {cardCount} cards
          </Text>
        )}

        {/* Deck Selection */}
        <View style={styles.section}>
          <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>Deck</Text>
          <View style={styles.deckList}>
            {decks.map((deck) => {
              const ds = stats.find((s) => s.deck_id === deck.id)
              const isSelected = selectedDeckId === deck.id
              return (
                <TouchableOpacity
                  key={deck.id}
                  {...testProps(`study-deck-${deck.id}`)}
                  onPress={() => setSelectedDeckId(deck.id)}
                  style={[
                    styles.deckChip,
                    {
                      backgroundColor: isSelected ? palette.blue[50] : theme.colors.surfaceElevated,
                      borderColor: isSelected ? palette.blue[500] : theme.colors.border,
                      borderWidth: isSelected ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={styles.deckEmoji}>{deck.icon}</Text>
                  <View style={styles.deckChipInfo}>
                    <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                      {deck.name}
                    </Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                      {ds?.total_cards ?? 0} cards · {(ds?.review_cards ?? 0) + (ds?.learning_cards ?? 0)} due
                    </Text>
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Mode Selection — matches web: vertical list of p-3 rounded-xl border-2 cards */}
        <View style={styles.section}>
          <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>Study Mode</Text>
          <View style={styles.modeList}>
            {MODES.map((m) => {
              const isSelected = selectedMode === m.mode
              return (
                <TouchableOpacity
                  key={m.mode}
                  {...testProps(`study-mode-${m.mode}`)}
                  onPress={() => setSelectedMode(m.mode)}
                  style={[
                    styles.modeCard,
                    {
                      backgroundColor: isSelected ? palette.blue[50] : theme.colors.surfaceElevated,
                      borderColor: isSelected ? palette.blue[500] : theme.colors.border,
                      borderWidth: isSelected ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={styles.modeEmoji}>{m.emoji}</Text>
                  <View style={styles.modeInfo}>
                    <Text style={[theme.typography.label, { color: theme.colors.text }]}>{m.label}</Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{m.desc}</Text>
                    {isSelected && (
                      <Text style={[theme.typography.caption, { color: palette.blue[600], marginTop: 2 }]}>{m.detail}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Batch Size — matches web: number input */}
        {showBatchSize && (
          <View style={styles.section}>
            <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>Cards per session</Text>
            <TextInput
              testID="study-batch-input"
              value={batchSize}
              onChangeText={setBatchSize}
              keyboardType="number-pad"
              placeholder="20"
            />
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              Between 5 and 500 cards
            </Text>
          </View>
        )}

        {/* Cramming Setup — matches web CrammingSetupPanel */}
        {selectedMode === 'cramming' && (
          <View style={[styles.section, styles.panelCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Cramming Options</Text>

            {/* Filter */}
            <View style={styles.subsection}>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>Card Filter</Text>
              <View style={styles.chipRow}>
                {CRAMMING_FILTERS.map((f) => {
                  const active = crammingFilter === f.value
                  return (
                    <TouchableOpacity
                      key={f.value}
                      testID={`study-cram-filter-${f.value}`}
                      onPress={() => setCrammingFilter(f.value)}
                      style={[styles.filterChip, {
                        backgroundColor: active ? theme.colors.primary : 'transparent',
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                      }]}
                    >
                      <Text style={[theme.typography.caption, { color: active ? theme.colors.primaryText : theme.colors.text }]}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            {/* Time Limit */}
            <View style={styles.subsection}>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>Time Limit</Text>
              <View style={styles.chipRow}>
                {TIME_LIMITS.map((t) => {
                  const active = crammingTimeLimit === t.value
                  return (
                    <TouchableOpacity
                      key={String(t.value)}
                      testID={`study-cram-time-${t.value ?? 'none'}`}
                      onPress={() => setCrammingTimeLimit(t.value)}
                      style={[styles.filterChip, {
                        backgroundColor: active ? theme.colors.primary : 'transparent',
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                      }]}
                    >
                      <Text style={[theme.typography.caption, { color: active ? theme.colors.primaryText : theme.colors.text }]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            {/* Shuffle */}
            <View style={styles.toggleRow}>
              <Text style={[theme.typography.body, { color: theme.colors.text }]}>Shuffle Cards</Text>
              <Switch
                testID="study-cram-shuffle"
                value={crammingShuffle}
                onValueChange={setCrammingShuffle}
                trackColor={{ true: theme.colors.primary }}
              />
            </View>
          </View>
        )}

        {/* By Date info */}
        {selectedMode === 'by_date' && (
          <View style={[styles.section, styles.panelCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Date Selection</Text>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
              Select a date to study cards added on that day. Date picker will show after starting.
            </Text>
          </View>
        )}

        {/* Start Button — matches web: w-full py-3 rounded-xl */}
        <Button
          testID="study-start-button"
          title={isLoading ? 'Loading...' : 'Start Study'}
          onPress={handleStart}
          loading={isLoading}
          disabled={!selectedDeckId}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 20, paddingVertical: 16 },
  backBtn: { paddingVertical: 4 },
  section: { gap: 8 },
  subsection: { gap: 6 },
  deckList: { gap: 8 },
  deckChip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12 },
  deckEmoji: { fontSize: 24 },
  deckChipInfo: { flex: 1, gap: 2 },
  modeList: { gap: 8 },
  modeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12 },
  modeEmoji: { fontSize: 24, marginTop: 2 },
  modeInfo: { flex: 1, gap: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
})
