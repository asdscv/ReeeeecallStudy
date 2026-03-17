import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useStudy } from '../hooks/useStudy'
import { useTheme } from '../theme'
import type { StudyStackParamList } from '../navigation/types'
import type { StudyMode } from '@reeeeecall/shared/types/database'

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySetup'>
type Route = RouteProp<StudyStackParamList, 'StudySetup'>

interface ModeOption {
  mode: StudyMode
  label: string
  icon: string
  description: string
}

const MODES: ModeOption[] = [
  { mode: 'srs', label: 'SRS Review', icon: '🧠', description: 'Smart spaced repetition' },
  { mode: 'sequential_review', label: 'Sequential', icon: '📖', description: 'In order, mixing new + review' },
  { mode: 'random', label: 'Random', icon: '🎲', description: 'Shuffled cards' },
  { mode: 'cramming', label: 'Cramming', icon: '⚡', description: 'Rapid-fire until mastered' },
]

const BATCH_SIZES = [10, 20, 50, 100]

export function StudySetupScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const preselectedDeckId = route.params?.deckId

  const { decks, stats, refresh } = useDecks()
  const { startSession, phase } = useStudy()

  // Re-fetch deck list when screen comes into focus (tab switch, back navigation)
  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  const [selectedDeckId, setSelectedDeckId] = useState(preselectedDeckId ?? '')
  const [selectedMode, setSelectedMode] = useState<StudyMode>('srs')
  const [batchSize, setBatchSize] = useState(20)

  const selectedDeck = decks.find((d) => d.id === selectedDeckId)
  const deckStats = stats.find((s) => s.deck_id === selectedDeckId)
  const isLoading = phase === 'loading'

  const handleStart = async () => {
    if (!selectedDeckId) {
      Alert.alert('Select a Deck', 'Please choose a deck to study')
      return
    }
    try {
      await startSession(selectedDeckId, selectedMode, batchSize)
      navigation.navigate('StudySession')
    } catch (e) {
      Alert.alert('Error', 'Failed to start study session')
    }
  }

  return (
    <Screen scroll testID="study-setup-screen">
      <View style={styles.content}>
        <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Study</Text>

        {/* Deck Selection */}
        <View style={styles.section}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Deck</Text>
          <View style={styles.deckList}>
            {decks.map((deck) => {
              const ds = stats.find((s) => s.deck_id === deck.id)
              const isSelected = selectedDeckId === deck.id
              return (
                <TouchableOpacity
                  key={deck.id}
                  testID={`study-deck-${deck.id}`}
                  onPress={() => setSelectedDeckId(deck.id)}
                  style={[
                    styles.deckChip,
                    {
                      backgroundColor: isSelected ? theme.colors.primaryLight : theme.colors.surface,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={styles.deckEmoji}>{deck.icon}</Text>
                  <View style={styles.deckChipInfo}>
                    <Text style={[theme.typography.label, { color: isSelected ? theme.colors.primary : theme.colors.text }]} numberOfLines={1}>
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

        {/* Mode Selection */}
        <View style={styles.section}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Mode</Text>
          <View style={styles.modeGrid}>
            {MODES.map((m) => {
              const isSelected = selectedMode === m.mode
              return (
                <TouchableOpacity
                  key={m.mode}
                  testID={`study-mode-${m.mode}`}
                  onPress={() => setSelectedMode(m.mode)}
                  style={[
                    styles.modeCard,
                    {
                      backgroundColor: isSelected ? theme.colors.primaryLight : theme.colors.surface,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={styles.modeIcon}>{m.icon}</Text>
                  <Text style={[theme.typography.label, { color: isSelected ? theme.colors.primary : theme.colors.text }]}>
                    {m.label}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                    {m.description}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Batch Size */}
        <View style={styles.section}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Cards per session</Text>
          <View style={styles.batchRow}>
            {BATCH_SIZES.map((size) => (
              <TouchableOpacity
                key={size}
                testID={`study-batch-${size}`}
                onPress={() => setBatchSize(size)}
                style={[
                  styles.batchChip,
                  {
                    backgroundColor: batchSize === size ? theme.colors.primary : theme.colors.surface,
                    borderColor: batchSize === size ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text style={[
                  theme.typography.label,
                  { color: batchSize === size ? theme.colors.primaryText : theme.colors.text },
                ]}>
                  {size}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

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
  content: { gap: 24, paddingVertical: 16 },
  section: { gap: 12 },
  deckList: { gap: 8 },
  deckChip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  deckEmoji: { fontSize: 24 },
  deckChipInfo: { flex: 1, gap: 2 },
  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modeCard: { width: '47%', padding: 14, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', gap: 6 },
  modeIcon: { fontSize: 28 },
  batchRow: { flexDirection: 'row', gap: 10 },
  batchChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
})
