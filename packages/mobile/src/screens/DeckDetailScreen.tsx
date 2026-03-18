import { useState, useMemo } from 'react'
import { View, Text, FlatList, RefreshControl, Alert, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, FAB, EmptyState, Badge, ListCard, SearchBar } from '../components/ui'
import { UploadDateTab } from '../components/deck/UploadDateTab'
import { DeckStatsTab } from '../components/deck/DeckStatsTab'
import { useDecks } from '../hooks/useDecks'
import { useCards } from '../hooks/useCards'
import { useTheme, palette } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'DeckDetail'>
type Route = RouteProp<DecksStackParamList, 'DeckDetail'>

type TabKey = 'cards' | 'dates' | 'stats'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'cards', label: 'Cards' },
  { key: 'dates', label: 'Upload Date' },
  { key: 'stats', label: 'Statistics' },
]

const STATUS_FILTERS = ['all', 'new', 'learning', 'review'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export function DeckDetailScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const { deckId } = route.params

  const { decks, getStatsForDeck, deleteDeck } = useDecks()
  const { cards, loading, refresh, deleteCard } = useCards(deckId)

  const [activeTab, setActiveTab] = useState<TabKey>('cards')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const deck = decks.find((d) => d.id === deckId)
  const deckStats = getStatsForDeck(deckId)

  const filteredCards = useMemo(() => {
    let result = cards
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((c) =>
        Object.values(c.field_values).some((v) => v?.toLowerCase().includes(q)),
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.srs_status === statusFilter)
    }
    return result
  }, [cards, search, statusFilter])

  if (!deck) {
    return (
      <Screen testID="deck-detail-screen">
        <EmptyState icon="❓" title="Deck not found" actionTitle="Go Back" onAction={() => navigation.goBack()} />
      </Screen>
    )
  }

  const totalCards = deckStats?.total_cards ?? cards.length
  const dueCards = (deckStats?.review_cards ?? 0) + (deckStats?.learning_cards ?? 0)
  const newCards = deckStats?.new_cards ?? 0

  const handleDeleteDeck = () => {
    Alert.alert('Delete Deck', `Delete "${deck.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteDeck(deckId); navigation.goBack() } },
    ])
  }

  const renderHeader = () => (
    <View style={styles.header}>
      {/* Back button — matches web: text-sm text-gray-500 */}
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>← Back</Text>
      </TouchableOpacity>

      {/* Title: icon + name — matches web: flex items-center gap-2 */}
      <View style={styles.titleRow}>
        <Text style={styles.titleIcon}>{deck.icon}</Text>
        <Text style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>{deck.name}</Text>
      </View>

      {deck.description && (
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{deck.description}</Text>
      )}

      {/* Stats badges — matches web: flex-wrap gap-2 */}
      <View style={styles.badgeRow}>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{totalCards} cards</Text>
        {newCards > 0 && <Text style={[theme.typography.caption, { color: palette.blue[600] }]}>{newCards} new</Text>}
        {dueCards > 0 && <Text style={[theme.typography.caption, { color: palette.yellow[600] }]}>{dueCards} due</Text>}
      </View>

      {/* Action buttons — matches web: flex-wrap gap-2 mt-4 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionScroll}>
        <View style={styles.actionRow}>
          <Button title="Study" onPress={() => {}} size="sm" fullWidth={false} testID="deck-detail-study" />
          <Button title="Edit" variant="outline" size="sm" fullWidth={false}
            onPress={() => navigation.navigate('DeckEdit', { deckId })} testID="deck-detail-edit" />
          <Button title="Import/Export" variant="outline" size="sm" fullWidth={false}
            onPress={() => navigation.navigate('ImportExport', { deckId })} testID="deck-detail-import-export" />
          <Button title="Publish" variant="outline" size="sm" fullWidth={false}
            onPress={() => navigation.navigate('PublishDeck', { deckId })} testID="deck-detail-publish" />
          <Button title="Delete" variant="danger" size="sm" fullWidth={false}
            onPress={handleDeleteDeck} testID="deck-detail-delete" />
        </View>
      </ScrollView>

      {/* Tab Bar — matches web: flex border-b overflow-x-auto */}
      <View style={[styles.tabBar, { borderBottomColor: theme.colors.border }]}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[
                styles.tab,
                active && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 },
              ]}
              testID={`deck-tab-${tab.key}`}
            >
              <Text style={[
                theme.typography.bodySmall,
                { color: active ? theme.colors.primary : theme.colors.textSecondary, fontWeight: active ? '600' : '400' },
              ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Cards tab: search + filter chips */}
      {activeTab === 'cards' && (
        <>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search cards..." testID="deck-detail-search" />
          <View style={styles.filterRow}>
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f
              return (
                <TouchableOpacity
                  key={f}
                  onPress={() => setStatusFilter(f)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? theme.colors.primary : 'transparent',
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                  testID={`deck-filter-${f}`}
                >
                  <Text style={[
                    theme.typography.caption,
                    { color: active ? theme.colors.primaryText : theme.colors.textSecondary },
                  ]}>
                    {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </>
      )}
    </View>
  )

  // Non-cards tabs
  if (activeTab === 'dates' || activeTab === 'stats') {
    return (
      <Screen safeArea padding={false} testID="deck-detail-screen">
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        >
          {renderHeader()}
          <View style={styles.tabContent}>
            {activeTab === 'dates' ? (
              <UploadDateTab
                cards={cards}
                onCardPress={(cardId) => navigation.navigate('CardEdit', { deckId, cardId })}
                testID="deck-dates-tab"
              />
            ) : (
              <DeckStatsTab cards={cards} testID="deck-stats-tab" />
            )}
          </View>
        </ScrollView>
      </Screen>
    )
  }

  // Cards tab — mobile card-based view (matches web md:hidden view)
  return (
    <Screen safeArea padding={false} testID="deck-detail-screen">
      <FlatList
        data={filteredCards}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={[styles.list, filteredCards.length === 0 && styles.listEmpty]}
        ListHeaderComponent={renderHeader()}
        renderItem={({ item }) => {
          const fields = Object.values(item.field_values)
          return (
            <TouchableOpacity
              onPress={() => navigation.navigate('CardEdit', { deckId, cardId: item.id })}
              activeOpacity={0.7}
              style={[styles.cardItem, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
              testID={`card-item-${item.id}`}
            >
              <View style={styles.cardContent}>
                {fields.slice(0, 3).map((val, idx) => (
                  <Text
                    key={idx}
                    style={[
                      idx === 0 ? theme.typography.label : theme.typography.bodySmall,
                      { color: idx === 0 ? theme.colors.text : theme.colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {val || '(empty)'}
                  </Text>
                ))}
              </View>
              <Badge label={item.srs_status} variant={
                item.srs_status === 'new' ? 'primary' :
                item.srs_status === 'review' ? 'success' :
                item.srs_status === 'learning' ? 'warning' : 'neutral'
              } />
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="🃏"
              title="No cards yet"
              description="Add your first card to this deck"
              actionTitle="Add Card"
              onAction={() => navigation.navigate('CardEdit', { deckId })}
              testID="deck-detail-empty"
            />
          ) : null
        }
      />
      <FAB onPress={() => navigation.navigate('CardEdit', { deckId })} testID="deck-detail-fab-add" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 80, gap: 8 },
  listEmpty: { flex: 1 },
  header: { gap: 10, paddingTop: 8, paddingBottom: 8 },
  backBtn: { paddingVertical: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleIcon: { fontSize: 24 },
  badgeRow: { flexDirection: 'row', gap: 12 },
  actionScroll: { flexGrow: 0 },
  actionRow: { flexDirection: 'row', gap: 8 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  tabContent: { paddingTop: 8 },
  // Matches web mobile card view: rounded-xl border p-3
  cardItem: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  cardContent: { flex: 1, gap: 2 },
})
