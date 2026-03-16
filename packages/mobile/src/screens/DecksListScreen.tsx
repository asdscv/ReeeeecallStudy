import { useState, useMemo } from 'react'
import { View, Text, FlatList, RefreshControl, Alert, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, FAB, EmptyState, SearchBar, ListCard, Badge } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useTheme } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'DecksList'>

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
    Alert.alert(
      'Delete Deck',
      `Are you sure you want to delete "${name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteDeck(deckId),
        },
      ],
    )
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
            <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Decks</Text>
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Search decks..."
              testID="decks-search"
            />
          </View>
        }
        renderItem={({ item }) => {
          const deckStats = stats.find((s) => s.deck_id === item.id)
          return (
            <DeckListCard
              name={item.name}
              description={item.description}
              icon={item.icon}
              color={item.color}
              totalCards={deckStats?.total_cards ?? 0}
              dueCards={(deckStats?.review_cards ?? 0) + (deckStats?.learning_cards ?? 0)}
              newCards={deckStats?.new_cards ?? 0}
              onPress={() => navigation.navigate('DeckDetail', { deckId: item.id })}
              onLongPress={() => handleDelete(item.id, item.name)}
              testID={`deck-card-${item.id}`}
            />
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

function DeckListCard({ name, description, icon, color, totalCards, dueCards, newCards, onPress, onLongPress, testID }: {
  name: string; description: string | null; icon: string; color: string
  totalCards: number; dueCards: number; newCards: number
  onPress: () => void; onLongPress: () => void; testID?: string
}) {
  const theme = useTheme()
  return (
    <ListCard onPress={onPress} testID={testID}>
      <View style={styles.deckRow}>
        <View style={[styles.colorBar, { backgroundColor: color }]} />
        <View style={styles.deckContent}>
          <View style={styles.deckTitleRow}>
            <Text style={styles.deckEmoji}>{icon}</Text>
            <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
              {name}
            </Text>
          </View>
          {description && (
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={2}>
              {description}
            </Text>
          )}
          <View style={styles.badgeRow}>
            <Badge label={`${totalCards} cards`} variant="neutral" />
            {dueCards > 0 && <Badge label={`${dueCards} due`} variant="warning" />}
            {newCards > 0 && <Badge label={`${newCards} new`} variant="primary" />}
          </View>
        </View>
      </View>
    </ListCard>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 80, gap: 10 },
  listEmpty: { flex: 1 },
  header: { gap: 12, paddingTop: 16, paddingBottom: 8 },
  deckRow: { flexDirection: 'row', gap: 12 },
  colorBar: { width: 4, borderRadius: 2, alignSelf: 'stretch' },
  deckContent: { flex: 1, gap: 6 },
  deckTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deckEmoji: { fontSize: 20 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
})
