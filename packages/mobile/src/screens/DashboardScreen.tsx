import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, ListCard, Badge } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../theme'
import type { MainTabParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<MainTabParamList>

export function DashboardScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { decks, stats, loading, refresh } = useDecks()
  const { signOut } = useAuth()

  const totalDue = stats.reduce((sum, s) => sum + (s.review_cards ?? 0) + (s.learning_cards ?? 0), 0)
  const totalNew = stats.reduce((sum, s) => sum + (s.new_cards ?? 0), 0)
  const totalCards = stats.reduce((sum, s) => sum + (s.total_cards ?? 0), 0)

  return (
    <Screen safeArea padding={false} testID="dashboard-screen">
      <FlatList
        data={decks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Greeting */}
            <View style={styles.titleRow}>
              <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Home</Text>
              <TouchableOpacity onPress={signOut} testID="dashboard-logout">
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>Logout</Text>
              </TouchableOpacity>
            </View>

            {/* Stats Row */}
            <View style={styles.statsRow}>
              <StatCard label="Due Today" value={totalDue} variant="warning" theme={theme} testID="dashboard-stat-due" />
              <StatCard label="New Cards" value={totalNew} variant="primary" theme={theme} testID="dashboard-stat-new" />
              <StatCard label="Total Cards" value={totalCards} variant="neutral" theme={theme} testID="dashboard-stat-total" />
            </View>

            {/* Quick Study */}
            {totalDue > 0 && (
              <TouchableOpacity
                style={[styles.quickStudy, { backgroundColor: theme.colors.primary }]}
                onPress={() => navigation.navigate('StudyTab')}
                testID="dashboard-quick-study"
              >
                <Text style={[theme.typography.button, { color: theme.colors.primaryText }]}>
                  Start Studying ({totalDue} due)
                </Text>
              </TouchableOpacity>
            )}

            {/* Section title */}
            <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 8 }]}>
              My Decks
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const deckStats = stats.find((s) => s.deck_id === item.id)
          return (
            <DeckQuickCard
              name={item.name}
              icon={item.icon}
              color={item.color}
              totalCards={deckStats?.total_cards ?? 0}
              dueCards={(deckStats?.review_cards ?? 0) + (deckStats?.learning_cards ?? 0)}
              newCards={deckStats?.new_cards ?? 0}
              onPress={() => navigation.navigate('DecksTab')}
              testID={`dashboard-deck-${item.id}`}
            />
          )
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                No decks yet. Go to Decks tab to create one!
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

function StatCard({ label, value, variant, theme, testID }: {
  label: string; value: number; variant: 'primary' | 'warning' | 'neutral'
  theme: ReturnType<typeof useTheme>; testID?: string
}) {
  const bgMap = { primary: theme.colors.primaryLight, warning: '#FEF9C3', neutral: theme.colors.surface }
  return (
    <View style={[styles.statCard, { backgroundColor: bgMap[variant] }]} testID={testID}>
      <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{value}</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{label}</Text>
    </View>
  )
}

function DeckQuickCard({ name, icon, color, totalCards, dueCards, newCards, onPress, testID }: {
  name: string; icon: string; color: string; totalCards: number; dueCards: number; newCards: number
  onPress: () => void; testID?: string
}) {
  const theme = useTheme()
  return (
    <ListCard onPress={onPress} testID={testID}>
      <View style={styles.deckRow}>
        <View style={[styles.deckIcon, { backgroundColor: color + '20' }]}>
          <Text style={styles.deckEmoji}>{icon}</Text>
        </View>
        <View style={styles.deckInfo}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {totalCards} cards
          </Text>
        </View>
        <View style={styles.deckBadges}>
          {dueCards > 0 && <Badge label={`${dueCards} due`} variant="warning" />}
          {newCards > 0 && <Badge label={`${newCards} new`} variant="primary" />}
        </View>
      </View>
    </ListCard>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  header: { gap: 16, paddingTop: 16, paddingBottom: 8 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderRadius: 12, padding: 14, alignItems: 'center', gap: 4 },
  quickStudy: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  deckRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deckIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  deckEmoji: { fontSize: 22 },
  deckInfo: { flex: 1, gap: 2 },
  deckBadges: { flexDirection: 'row', gap: 6 },
  empty: { padding: 40 },
})
