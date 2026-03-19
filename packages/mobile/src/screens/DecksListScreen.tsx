import { useState, useMemo } from 'react'
import { View, Text, FlatList, RefreshControl, Alert, TouchableOpacity, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, FAB, EmptyState, SearchBar, DrawerHeader, Button } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('decks')
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
    Alert.alert(t('deleteDeck'), t('deleteConfirm', { name: "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDeck(deckId) },
    ])
  }

  return (
    <Screen safeArea padding={false} testID="decks-list-screen">
      <DrawerHeader title={t('title')} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        contentContainerStyle={[styles.list, filtered.length === 0 && styles.listEmpty]}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Action buttons — matches web: AI Generate (purple) + Create New (blue) */}
            <View style={styles.headerButtons}>
              <TouchableOpacity
                testID="decks-ai-generate"
                onPress={() => {
                  const tabNav = navigation.getParent()
                  if (tabNav) tabNav.navigate('SettingsTab', { screen: 'AIGenerate' })
                }}
                style={[styles.headerBtn, { backgroundColor: '#7C3AED' }]}
              >
                <Text style={styles.headerBtnText}>🤖 AI Generate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="decks-create-new"
                onPress={() => navigation.navigate('DeckEdit', {})}
                style={[styles.headerBtn, { backgroundColor: palette.blue[600] }]}
              >
                <Text style={styles.headerBtnText}>+ Create New</Text>
              </TouchableOpacity>
            </View>
            <SearchBar value={search} onChangeText={setSearch} placeholder={t('searchPlaceholder')} testID="decks-search" />
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
                      onPress={() => {
                        // Navigate to StudyTab with deckId preselected (matches web behavior)
                        const tabNav = navigation.getParent()
                        if (tabNav) {
                          tabNav.navigate('StudyTab', { screen: 'StudySetup', params: { deckId: item.id } })
                        }
                      }}
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
              title={t('empty')}
              description={t('emptyDescription')}
              actionTitle={t('createFirst')}
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
  header: { gap: 12, paddingTop: 12, paddingBottom: 8 },
  headerButtons: { flexDirection: 'row', gap: 8 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  headerBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
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
