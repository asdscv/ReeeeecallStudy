import { useState, useMemo } from 'react'
import { View, Text, FlatList, RefreshControl, Alert, TouchableOpacity, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, FAB, EmptyState, SearchBar } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useTheme, palette } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'DecksList'>

/**
 * Matches web DecksPage + DeckCard exactly:
 * - Left color bar (w-1 shrink-0)
 * - Icon + Name header
 * - Description (line-clamp-1)
 * - Stats row: total, new (blue), due (amber)
 * - Footer: edit/delete/study buttons
 */
export function DecksListScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { decks, stats, loading, refresh, deleteDeck } = useDecks()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return decks
    const q = search.toLowerCase()
    return decks.filter((d) =>
      d.name.toLowerCase().includes(q) ||
      d.description?.toLowerCase().includes(q),
    )
  }, [decks, search])

  const handleDelete = (deckId: string, name: string) => {
    Alert.alert('Delete Deck', `Are you sure you want to delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDeck(deckId) },
    ])
  }

  return (
    <Screen safeArea padding={false} testID="decks-list-screen">
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={[styles.list, filtered.length === 0 && styles.listEmpty]}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Decks</Text>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search decks..." testID="decks-search" />
          </View>
        }
        renderItem={({ item }) => {
          const ds = stats.find((s) => s.deck_id === item.id)
          const totalCards = ds?.total_cards ?? 0
          const dueCards = (ds?.review_cards ?? 0) + (ds?.learning_cards ?? 0)
          const newCards = ds?.new_cards ?? 0

          return (
            <TouchableOpacity
              onPress={() => navigation.navigate('DeckDetail', { deckId: item.id })}
              onLongPress={() => handleDelete(item.id, item.name)}
              activeOpacity={0.7}
              style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
              testID={`deck-card-${item.id}`}
            >
              {/* Left color bar — matches web: w-1 shrink-0 rounded-l-xl */}
              <View style={[styles.colorBar, { backgroundColor: item.color }]} />

              <View style={styles.cardBody}>
                {/* Header: icon + name */}
                <View style={styles.nameRow}>
                  <Text style={styles.deckIcon}>{item.icon}</Text>
                  <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>

                {/* Description */}
                {item.description && (
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {item.description}
                  </Text>
                )}

                {/* Stats row — matches web: text-xs text-gray-500, blue/amber colors */}
                <View style={styles.statsRow}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {totalCards} cards
                  </Text>
                  {newCards > 0 && (
                    <Text style={[theme.typography.caption, { color: palette.blue[600] }]}>
                      {newCards} new
                    </Text>
                  )}
                  {dueCards > 0 && (
                    <Text style={[theme.typography.caption, { color: palette.yellow[600] }]}>
                      {dueCards} due
                    </Text>
                  )}
                </View>

                {/* Footer — matches web: border-t, edit/delete/study */}
                <View style={[styles.footer, { borderTopColor: theme.colors.border }]}>
                  <View style={styles.footerActions}>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('DeckEdit', { deckId: item.id })}
                      style={styles.iconBtn}
                      testID={`deck-card-${item.id}-edit`}
                    >
                      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(item.id, item.name)}
                      style={styles.iconBtn}
                      testID={`deck-card-${item.id}-delete`}
                    >
                      <Text style={[theme.typography.caption, { color: palette.red[500] }]}>Delete</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('DeckDetail', { deckId: item.id })}
                      style={[styles.studyBtn, { backgroundColor: palette.blue[50] }]}
                      testID={`deck-card-${item.id}-study`}
                    >
                      <Text style={[theme.typography.caption, { color: palette.blue[600], fontWeight: '500' }]}>
                        Study
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="📚"
              title="No decks yet"
              description="Create your first deck to start learning"
              actionTitle="Create Deck"
              onAction={() => navigation.navigate('DeckEdit', {})}
              testID="decks-empty"
            />
          ) : null
        }
      />
      <FAB
        onPress={() => navigation.navigate('DeckEdit', {})}
        testID="decks-fab-create"
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 80, gap: 12 },
  listEmpty: { flex: 1 },
  header: { gap: 12, paddingTop: 16, paddingBottom: 8 },
  // Matches web: rounded-xl border overflow-hidden flex
  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', flexDirection: 'row' },
  colorBar: { width: 4 },
  cardBody: { flex: 1, padding: 12, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deckIcon: { fontSize: 22 },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 2 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingTop: 10, marginTop: 6, borderTopWidth: 1 },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  studyBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
})
