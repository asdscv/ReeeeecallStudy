import { View, Text, FlatList, RefreshControl, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, FAB, EmptyState, Badge, ListCard } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useCards } from '../hooks/useCards'
import { useTheme } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'DeckDetail'>
type Route = RouteProp<DecksStackParamList, 'DeckDetail'>

export function DeckDetailScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const { deckId } = route.params

  const { decks, getStatsForDeck, deleteDeck } = useDecks()
  const { cards, loading, refresh, deleteCard } = useCards(deckId)

  const deck = decks.find((d) => d.id === deckId)
  const deckStats = getStatsForDeck(deckId)

  if (!deck) {
    return (
      <Screen testID="deck-detail-screen">
        <EmptyState icon="❓" title="Deck not found" actionTitle="Go Back" onAction={() => navigation.goBack()} />
      </Screen>
    )
  }

  const handleDeleteCard = (cardId: string) => {
    Alert.alert('Delete Card', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCard(cardId) },
    ])
  }

  const handleDeleteDeck = () => {
    Alert.alert('Delete Deck', `Delete "${deck.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteDeck(deckId)
          navigation.goBack()
        },
      },
    ])
  }

  return (
    <Screen safeArea padding={false} testID="deck-detail-screen">
      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={[styles.list, cards.length === 0 && styles.listEmpty]}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Back + Actions */}
            <View style={styles.topRow}>
              <Button title="← Back" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />
              <View style={styles.actions}>
                <Button title="Edit" variant="outline" size="sm" fullWidth={false}
                  onPress={() => navigation.navigate('DeckEdit', { deckId })} testID="deck-detail-edit" />
                <Button title="Delete" variant="danger" size="sm" fullWidth={false}
                  onPress={handleDeleteDeck} testID="deck-detail-delete" />
              </View>
            </View>

            {/* Deck Info */}
            <View style={styles.deckInfo}>
              <View style={[styles.deckIconLg, { backgroundColor: deck.color + '20' }]}>
                <Text style={styles.deckEmojiLg}>{deck.icon}</Text>
              </View>
              <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{deck.name}</Text>
              {deck.description && (
                <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{deck.description}</Text>
              )}
              <View style={styles.badgeRow}>
                <Badge label={`${deckStats?.total_cards ?? cards.length} cards`} variant="neutral" />
                {(deckStats?.review_cards ?? 0) + (deckStats?.learning_cards ?? 0) > 0 && (
                  <Badge label={`${(deckStats?.review_cards ?? 0) + (deckStats?.learning_cards ?? 0)} due`} variant="warning" />
                )}
                {(deckStats?.new_cards ?? 0) > 0 && (
                  <Badge label={`${deckStats?.new_cards} new`} variant="primary" />
                )}
              </View>
            </View>

            {/* Action buttons */}
            <View style={styles.actionRow}>
              <Button title="📥 Import/Export" variant="outline" size="sm" fullWidth={false}
                onPress={() => navigation.navigate('ImportExport', { deckId })} testID="deck-detail-import-export" />
              <Button title="📤 Publish" variant="outline" size="sm" fullWidth={false}
                onPress={() => navigation.navigate('PublishDeck', { deckId })} testID="deck-detail-publish" />
            </View>

            {/* Study button */}
            <Button title="Start Study" onPress={() => {}} testID="deck-detail-study" />

            <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 8 }]}>Cards</Text>
          </View>
        }
        renderItem={({ item }) => {
          const firstFieldValue = Object.values(item.field_values)[0] ?? ''
          const secondFieldValue = Object.values(item.field_values)[1] ?? ''
          return (
            <ListCard
              onPress={() => navigation.navigate('CardEdit', { deckId, cardId: item.id })}
              testID={`card-item-${item.id}`}
            >
              <View style={styles.cardRow}>
                <View style={styles.cardContent}>
                  <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                    {firstFieldValue || '(empty)'}
                  </Text>
                  {secondFieldValue ? (
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                      {secondFieldValue}
                    </Text>
                  ) : null}
                </View>
                <Badge label={item.srs_status} variant={
                  item.srs_status === 'new' ? 'primary' :
                  item.srs_status === 'review' ? 'success' :
                  item.srs_status === 'learning' ? 'warning' : 'neutral'
                } />
              </View>
            </ListCard>
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
      <FAB
        onPress={() => navigation.navigate('CardEdit', { deckId })}
        testID="deck-detail-fab-add"
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 80, gap: 8 },
  listEmpty: { flex: 1 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  deckInfo: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  deckIconLg: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  deckEmojiLg: { fontSize: 32 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardContent: { flex: 1, gap: 2 },
  actionRow: { flexDirection: 'row', gap: 8 },
})
