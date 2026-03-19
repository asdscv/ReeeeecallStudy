import { useState, useCallback, useEffect } from 'react'
import { View, Text, TouchableOpacity, Switch, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, TextInput, DrawerHeader } from '../components/ui'
import { testProps } from '../utils/testProps'
import { useDecks } from '../hooks/useDecks'
import { useStudy } from '../hooks/useStudy'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { getMobileSupabase } from '../adapters'
import { todayDateKey, utcToLocalDateKey, localDateToUTCRange } from '@reeeeecall/shared/lib/date-utils'
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
  { mode: 'sequential_review', emoji: '🔄', label: 'Sequential Review', desc: 'In order, mixing new + review cards', detail: 'Go through cards sequentially from where you left off' },
  { mode: 'random', emoji: '🎲', label: 'Random', desc: 'Shuffled cards', detail: 'Cards are randomly selected from the deck' },
  { mode: 'sequential', emoji: '➡️', label: 'Sequential', desc: 'Cards in order, one by one', detail: 'Go through cards in the order they were added' },
  { mode: 'by_date', emoji: '📅', label: 'By Date', desc: 'Study cards by upload date', detail: 'Select a date to study cards added on that day' },
  { mode: 'cramming', emoji: '⚡', label: 'Cramming', desc: 'Rapid-fire until mastered', detail: 'Missed cards return until you get them all right' },
]

const CRAMMING_FILTERS = [
  { value: 'all', label: 'All Cards' },
  { value: 'weak', label: 'Weak Cards' },
  { value: 'due_soon', label: 'Due Soon' },
] as const

const TIME_LIMITS = [
  { value: null, label: 'No Limit' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
] as const

export function StudySetupScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
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

  // By-date mode settings
  const [selectedDate, setSelectedDate] = useState(() => todayDateKey())
  const [datesWithCards, setDatesWithCards] = useState<Set<string>>(new Set())
  const [dateCardCount, setDateCardCount] = useState(0)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  // Fetch dates that have cards when deck is selected
  useEffect(() => {
    if (!selectedDeckId) return
    const supabase = getMobileSupabase()
    supabase
      .from('cards')
      .select('created_at')
      .eq('deck_id', selectedDeckId)
      .neq('srs_status', 'suspended')
      .then(({ data }) => {
        if (data) {
          const dates = new Set<string>()
          data.forEach((c: { created_at: string }) => {
            dates.add(utcToLocalDateKey(c.created_at))
          })
          setDatesWithCards(dates)
        }
      })
  }, [selectedDeckId])

  // Fetch card count for selected date
  useEffect(() => {
    if (!selectedDeckId || selectedMode !== 'by_date' || !selectedDate) return
    const supabase = getMobileSupabase()
    const { start: dateStart, end: dateEnd } = localDateToUTCRange(selectedDate)
    supabase
      .from('cards')
      .select('*', { count: 'exact', head: true })
      .eq('deck_id', selectedDeckId)
      .neq('srs_status', 'suspended')
      .gte('created_at', dateStart)
      .lte('created_at', dateEnd)
      .then(({ count }) => {
        setDateCardCount(count ?? 0)
      })
  }, [selectedDeckId, selectedMode, selectedDate])

  const selectedDeck = decks.find((d) => d.id === selectedDeckId)
  const deckStats = stats.find((s) => s.deck_id === selectedDeckId)
  const cardCount = deckStats?.total_cards ?? 0
  const isLoading = phase === 'loading'

  // Batch size is configurable only for sequential_review, random, sequential (not srs, by_date, cramming)
  const showBatchSize = selectedMode !== 'cramming' && selectedMode !== 'srs' && selectedMode !== 'by_date'

  const handleStart = async () => {
    if (!selectedDeckId) {
      Alert.alert('Select a Deck', 'Please choose a deck to study')
      return
    }
    if (selectedMode === 'by_date' && dateCardCount === 0) {
      Alert.alert('No Cards', 'No cards found for the selected date')
      return
    }
    const size = parseInt(batchSize) || 20
    try {
      // For by_date mode, pass date range
      let uploadDateStart: string | undefined
      let uploadDateEnd: string | undefined
      if (selectedMode === 'by_date' && selectedDate) {
        const range = localDateToUTCRange(selectedDate)
        uploadDateStart = range.start
        uploadDateEnd = range.end
      }
      await startSession(selectedDeckId, selectedMode, size, uploadDateStart, uploadDateEnd)
      navigation.navigate('StudySession')
    } catch (e) {
      Alert.alert('Error', 'Failed to start study session')
    }
  }

  return (
    <Screen scroll testID="study-setup-screen">
      <DrawerHeader title={t('setup.title')} />
      <View style={styles.content}>
        {/* Back button — matches web */}
        {selectedDeck && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>← {selectedDeck.name}</Text>
          </TouchableOpacity>
        )}

        {selectedDeck && (
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            {selectedDeck.icon} {selectedDeck.name} · {cardCount} cards
          </Text>
        )}

        {/* Deck Selection */}
        <View style={styles.section}>
          <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>{t('setup.deck')}</Text>
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
          <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>{t('setup.studyMode')}</Text>
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
            <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>{t('setup.cardsPerSession')}</Text>
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
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('cramming.options')}</Text>

            {/* Filter */}
            <View style={styles.subsection}>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('cramming.filter.title')}</Text>
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
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('cramming.timeLimit.title')}</Text>
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
              <Text style={[theme.typography.body, { color: theme.colors.text }]}>{t('cramming.shuffle.title')}</Text>
              <Switch
                testID="study-cram-shuffle"
                value={crammingShuffle}
                onValueChange={setCrammingShuffle}
                trackColor={{ true: theme.colors.primary }}
              />
            </View>
          </View>
        )}

        {/* By Date — calendar date picker */}
        {selectedMode === 'by_date' && (
          <View style={[styles.section, styles.panelCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Select Upload Date</Text>

            {/* Month navigation */}
            <View style={styles.calendarNav}>
              <TouchableOpacity
                onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                style={styles.calendarNavBtn}
              >
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>{'<'}</Text>
              </TouchableOpacity>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {calendarMonth.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
              </Text>
              <TouchableOpacity
                onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                style={styles.calendarNavBtn}
              >
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>{'>'}</Text>
              </TouchableOpacity>
            </View>

            {/* Day headers */}
            <View style={styles.calendarRow}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <View key={d} style={styles.calendarCell}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>{d}</Text>
                </View>
              ))}
            </View>

            {/* Calendar grid */}
            {(() => {
              const year = calendarMonth.getFullYear()
              const month = calendarMonth.getMonth()
              const daysInMonth = new Date(year, month + 1, 0).getDate()
              const firstDayOfWeek = new Date(year, month, 1).getDay()
              const totalCells = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7
              const todayStr = todayDateKey()
              const rows: React.ReactNode[] = []

              for (let rowStart = 0; rowStart < totalCells; rowStart += 7) {
                const cells: React.ReactNode[] = []
                for (let i = rowStart; i < rowStart + 7; i++) {
                  const day = i - firstDayOfWeek + 1
                  const isValid = day > 0 && day <= daysInMonth
                  if (!isValid) {
                    cells.push(<View key={i} style={styles.calendarCell} />)
                    continue
                  }
                  const monthStr = String(month + 1).padStart(2, '0')
                  const dayStr = String(day).padStart(2, '0')
                  const dateStr = `${year}-${monthStr}-${dayStr}`
                  const hasCards = datesWithCards.has(dateStr)
                  const isSelected = dateStr === selectedDate
                  const isToday = dateStr === todayStr

                  cells.push(
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.calendarCell,
                        styles.calendarDayBtn,
                        isSelected && { backgroundColor: palette.blue[600], borderRadius: 8 },
                        !isSelected && hasCards && { backgroundColor: palette.gray[100], borderRadius: 8 },
                        isToday && !isSelected && { borderWidth: 2, borderColor: palette.blue[400], borderRadius: 8 },
                      ]}
                      onPress={() => setSelectedDate(dateStr)}
                    >
                      <Text style={[
                        theme.typography.bodySmall,
                        { textAlign: 'center' },
                        isSelected && { color: '#FFFFFF', fontWeight: '700' },
                        !isSelected && hasCards && { color: theme.colors.text, fontWeight: '600' },
                        !isSelected && !hasCards && { color: palette.gray[300] },
                      ]}>
                        {day}
                      </Text>
                    </TouchableOpacity>
                  )
                }
                rows.push(
                  <View key={rowStart} style={styles.calendarRow}>{cells}</View>
                )
              }
              return rows
            })()}

            {/* Selected date card count */}
            {selectedDate && (
              <Text style={[theme.typography.bodySmall, { color: palette.blue[600], fontWeight: '500' }]}>
                {(() => {
                  const [y, m, d] = selectedDate.split('-').map(Number)
                  return `${y}/${m}/${d} — ${dateCardCount} card${dateCardCount !== 1 ? 's' : ''}`
                })()}
              </Text>
            )}
          </View>
        )}

        {/* Start Button — matches web: w-full py-3 rounded-xl */}
        <Button
          testID="study-start-button"
          title={isLoading ? t('session.loading') : t('setup.startStudy')}
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
  calendarNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calendarNavBtn: { padding: 8 },
  calendarRow: { flexDirection: 'row' },
  calendarCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', margin: 1 },
  calendarDayBtn: { padding: 2 },
})
