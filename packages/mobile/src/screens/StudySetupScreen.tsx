import { useState, useCallback, useEffect } from 'react'
import { View, Text, TouchableOpacity, Switch, Alert, StyleSheet, Modal, FlatList } from 'react-native'
import { useNavigation, useRoute, useFocusEffect, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, TextInput, ScreenHeader } from '../components/ui'
import { testProps } from '../utils/testProps'
import { useDecks } from '../hooks/useDecks'
import { useStudy } from '../hooks/useStudy'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { getMobileSupabase } from '../adapters'
import { todayDateKey, utcToLocalDateKey, localDateToUTCRange } from '@reeeeecall/shared/lib/date-utils'
import type { StudyStackParamList } from '../navigation/types'
import type { StudyMode } from '@reeeeecall/shared/types/database'
import type { CrammingFilter } from '@reeeeecall/shared/lib/cramming-queue'

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySetup'>
type Route = RouteProp<StudyStackParamList, 'StudySetup'>

function buildCrammingFilter(filterKey: string): CrammingFilter {
  switch (filterKey) {
    case 'weak': return { type: 'weak', maxEaseFactor: 2.1 }
    case 'due_soon': return { type: 'due_soon', withinDays: 3 }
    default: return { type: 'all' }
  }
}

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
  const { t } = useTranslation('study')
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
      await startSession(
        selectedDeckId, selectedMode, size, uploadDateStart, uploadDateEnd,
        selectedMode === 'cramming' ? buildCrammingFilter(crammingFilter) : undefined,
        selectedMode === 'cramming' ? crammingTimeLimit : undefined,
        selectedMode === 'cramming' ? crammingShuffle : undefined,
      )
      navigation.navigate('StudySession')
    } catch (e) {
      Alert.alert('Error', 'Failed to start study session')
    }
  }

  const closeModal = () => {
    setSelectedDeckId('')
    setSelectedMode('srs')
  }

  const handleModeSelect = (mode: StudyMode) => {
    setSelectedMode(mode)
    // SRS starts immediately (no config needed)
    if (mode === 'srs') {
      handleStartWithMode(mode)
    }
  }

  const handleStartWithMode = async (mode?: StudyMode) => {
    const m = mode ?? selectedMode
    if (!selectedDeckId) return
    if (m === 'by_date' && dateCardCount === 0) {
      Alert.alert('No Cards', 'No cards found for the selected date')
      return
    }
    const size = parseInt(batchSize) || 20
    try {
      let uploadDateStart: string | undefined
      let uploadDateEnd: string | undefined
      if (m === 'by_date' && selectedDate) {
        const range = localDateToUTCRange(selectedDate)
        uploadDateStart = range.start
        uploadDateEnd = range.end
      }
      await startSession(
        selectedDeckId, m, size, uploadDateStart, uploadDateEnd,
        m === 'cramming' ? buildCrammingFilter(crammingFilter) : undefined,
        m === 'cramming' ? crammingTimeLimit : undefined,
        m === 'cramming' ? crammingShuffle : undefined,
      )
      closeModal()
      navigation.navigate('StudySession')
    } catch {
      Alert.alert('Error', 'Failed to start study session')
    }
  }

  // Whether the modal should show config options (not just mode list)
  const showModeConfig = selectedMode === 'cramming' || selectedMode === 'by_date' || showBatchSize

  return (
    <Screen safeArea padding={false} keyboard testID="study-setup-screen">
      <ScreenHeader title={t('setup.title')} mode="drawer" />

      {/* Deck Grid — matches web: 2-column grid of deck cards */}
      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        renderItem={({ item: deck }) => {
          const ds = stats.find((s) => s.deck_id === deck.id)
          const newCards = ds?.new_cards ?? 0
          const reviewCards = (ds?.review_cards ?? 0) + (ds?.learning_cards ?? 0)
          return (
            <TouchableOpacity
              {...testProps(`study-deck-${deck.id}`)}
              onPress={() => { setSelectedDeckId(deck.id); setSelectedMode('srs') }}
              activeOpacity={0.7}
              style={[styles.deckCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
            >
              <View style={[styles.deckColorBar, { backgroundColor: deck.color || palette.blue[500] }]} />
              <View style={styles.deckCardBody}>
                <View style={styles.deckNameRow}>
                  <Text style={styles.deckEmoji}>{deck.icon || '\uD83D\uDCDA'}</Text>
                  <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                    {deck.name}
                  </Text>
                </View>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {ds?.total_cards ?? 0} cards
                </Text>
                <View style={styles.deckBadges}>
                  {newCards > 0 && (
                    <View style={[styles.badge, { backgroundColor: theme.colors.primaryLight }]}>
                      <Text style={[styles.badgeText, { color: theme.colors.primary }]}>New {newCards}</Text>
                    </View>
                  )}
                  {reviewCards > 0 && (
                    <View style={[styles.badge, { backgroundColor: theme.colors.surface }]}>
                      <Text style={[styles.badgeText, { color: theme.colors.warning }]}>Review {reviewCards}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={{ fontSize: 40 }}>{'\uD83D\uDCDA'}</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
              No decks yet. Create a deck first!
            </Text>
          </View>
        }
      />

      {/* Study Mode Modal — matches web: modal with steps */}
      <Modal visible={!!selectedDeckId} transparent animationType="fade" onRequestClose={closeModal}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeModal}>
          <View
            style={[styles.modalCard, { backgroundColor: theme.colors.surfaceElevated }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Modal header */}
            <View style={[styles.modalHeader, { borderBottomColor: theme.colors.border }]}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {selectedDeck?.icon} {selectedDeck?.name}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {!showModeConfig ? 'Select study mode' : selectedMode === 'by_date' ? 'Select date' : selectedMode === 'cramming' ? 'Cramming options' : 'Set batch size'}
              </Text>
            </View>

            {/* Step 1: Mode list (when no config needed) OR Step 2: Config */}
            {!showModeConfig ? (
              <View style={styles.modalBody}>
                {MODES.map((m) => (
                  <TouchableOpacity
                    key={m.mode}
                    {...testProps(`study-mode-${m.mode}`)}
                    onPress={() => handleModeSelect(m.mode)}
                    style={[styles.modeRow, { borderRadius: 12 }]}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.modeEmoji}>{m.emoji}</Text>
                    <View style={styles.modeInfo}>
                      <Text style={[theme.typography.label, { color: theme.colors.text }]}>{m.label}</Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{m.desc}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.modalBody}>
                {/* Mode indicator */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 18 }}>{MODES.find(m => m.mode === selectedMode)?.emoji}</Text>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                    {MODES.find(m => m.mode === selectedMode)?.label}
                  </Text>
                </View>

                {/* Batch Size */}
                {showBatchSize && (
                  <View style={styles.section}>
                    <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('setup.cardsPerSession')}</Text>
                    <TextInput
                      testID="study-batch-input"
                      value={batchSize}
                      onChangeText={(v) => setBatchSize(v.replace(/[^0-9]/g, ''))}
                      onBlur={() => {
                        const n = parseInt(batchSize) || 20
                        setBatchSize(String(Math.max(5, Math.min(500, n))))
                      }}
                      keyboardType="number-pad"
                      placeholder="20"
                    />
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>5–500 cards</Text>
                  </View>
                )}

                {/* Cramming */}
                {selectedMode === 'cramming' && (
                  <View style={styles.section}>
                    <View style={styles.subsection}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>Filter</Text>
                      <View style={styles.chipRow}>
                        {CRAMMING_FILTERS.map((f) => {
                          const active = crammingFilter === f.value
                          return (
                            <TouchableOpacity key={f.value} testID={`study-cram-filter-${f.value}`} onPress={() => setCrammingFilter(f.value)}
                              style={[styles.filterChip, { backgroundColor: active ? theme.colors.primary : 'transparent', borderColor: active ? theme.colors.primary : theme.colors.border }]}>
                              <Text style={[theme.typography.caption, { color: active ? theme.colors.primaryText : theme.colors.text }]}>{f.label}</Text>
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    </View>
                    <View style={styles.subsection}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>Time Limit</Text>
                      <View style={styles.chipRow}>
                        {TIME_LIMITS.map((tl) => {
                          const active = crammingTimeLimit === tl.value
                          return (
                            <TouchableOpacity key={String(tl.value)} testID={`study-cram-time-${tl.value ?? 'none'}`} onPress={() => setCrammingTimeLimit(tl.value)}
                              style={[styles.filterChip, { backgroundColor: active ? theme.colors.primary : 'transparent', borderColor: active ? theme.colors.primary : theme.colors.border }]}>
                              <Text style={[theme.typography.caption, { color: active ? theme.colors.primaryText : theme.colors.text }]}>{tl.label}</Text>
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    </View>
                    <View style={styles.toggleRow}>
                      <Text style={[theme.typography.body, { color: theme.colors.text }]}>Shuffle</Text>
                      <Switch testID="study-cram-shuffle" value={crammingShuffle} onValueChange={setCrammingShuffle} trackColor={{ true: theme.colors.primary }} />
                    </View>
                  </View>
                )}

                {/* By Date */}
                {selectedMode === 'by_date' && (
          <View style={[styles.section, { gap: 12 }]}>
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
                        !isSelected && hasCards && { backgroundColor: theme.colors.surface, borderRadius: 8 },
                        isToday && !isSelected && { borderWidth: 2, borderColor: palette.blue[400], borderRadius: 8 },
                      ]}
                      onPress={() => setSelectedDate(dateStr)}
                    >
                      <Text style={[
                        theme.typography.bodySmall,
                        { textAlign: 'center' },
                        isSelected && { color: '#FFFFFF', fontWeight: '700' },
                        !isSelected && hasCards && { color: theme.colors.text, fontWeight: '600' },
                        !isSelected && !hasCards && { color: theme.colors.textSecondary },
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

                {/* Start button inside modal */}
                <Button
                  testID="study-start-button"
                  title={isLoading ? 'Loading...' : t('setup.startStudy')}
                  onPress={() => handleStartWithMode()}
                  loading={isLoading}
                  disabled={selectedMode === 'by_date' && dateCardCount === 0}
                />
              </View>
            )}

            {/* Modal footer — Cancel/Back */}
            <TouchableOpacity
              onPress={showModeConfig ? () => setSelectedMode('srs') : closeModal}
              style={[styles.modalFooter, { borderTopColor: theme.colors.border }]}
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                {showModeConfig ? 'Back to mode select' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  // Grid
  gridContent: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 },
  gridRow: { gap: 10, marginBottom: 10 },
  // Deck card — matches web: rounded-xl border overflow-hidden
  deckCard: { flex: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  deckColorBar: { height: 6 },
  deckCardBody: { padding: 12, gap: 6 },
  deckNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deckEmoji: { fontSize: 22 },
  deckBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: '500' },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12, marginTop: 40 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 400, borderRadius: 16, maxHeight: '80%' },
  modalHeader: { padding: 16, borderBottomWidth: 1, gap: 4 },
  modalBody: { padding: 12, gap: 6 },
  modalFooter: { padding: 12, borderTopWidth: 1, alignItems: 'center' },
  // Mode rows inside modal
  modeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12 },
  modeEmoji: { fontSize: 22, marginTop: 2 },
  modeInfo: { flex: 1, gap: 2 },
  // Config sections
  section: { gap: 8 },
  subsection: { gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Calendar
  calendarNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  calendarNavBtn: { padding: 8 },
  calendarRow: { flexDirection: 'row' },
  calendarCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', margin: 1 },
  calendarDayBtn: { padding: 2 },
})
