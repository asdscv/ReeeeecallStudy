import { useState, useEffect, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, SearchBar, Badge, ListCard } from '../components/ui'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import { useTheme } from '../theme'
import type { MarketplaceStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<MarketplaceStackParamList, 'MarketplaceHome'>

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'language', label: 'Language' },
  { value: 'science', label: 'Science' },
  { value: 'math', label: 'Math' },
  { value: 'history', label: 'History' },
  { value: 'programming', label: 'Code' },
  { value: 'exam', label: 'Exam' },
  { value: 'other', label: 'Other' },
]

export function MarketplaceScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { listings, loading, fetchListings } = useMarketplaceStore()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

  useEffect(() => { fetchListings() }, [fetchListings])

  const filtered = useMemo(() => {
    let result = listings
    if (category) result = result.filter((l) => l.category === category)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((l) =>
        l.title.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.tags?.some((t: string) => t.toLowerCase().includes(q)),
      )
    }
    return result
  }, [listings, search, category])

  return (
    <Screen safeArea padding={false} testID="marketplace-screen">
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchListings} />}
        contentContainerStyle={[styles.list, filtered.length === 0 && styles.listEmpty]}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Marketplace</Text>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search decks..." testID="marketplace-search" />

            {/* Category filter */}
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={CATEGORIES}
              keyExtractor={(item) => item.value}
              contentContainerStyle={styles.categoryRow}
              renderItem={({ item }) => (
                <TouchableOpacity
                  testID={`marketplace-cat-${item.value || 'all'}`}
                  onPress={() => setCategory(item.value)}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: category === item.value ? theme.colors.primaryLight : theme.colors.surface,
                      borderColor: category === item.value ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[
                    theme.typography.labelSmall,
                    { color: category === item.value ? theme.colors.primary : theme.colors.text },
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        }
        renderItem={({ item }) => (
          <ListCard
            onPress={() => navigation.navigate('MarketplaceDetail', { listingId: item.id })}
            testID={`marketplace-listing-${item.id}`}
          >
            <View style={styles.listingContent}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                {item.title}
              </Text>
              {item.description && (
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                  {item.description}
                </Text>
              )}
              <View style={styles.metaRow}>
                <Badge label={`${item.card_count ?? 0} cards`} variant="neutral" />
                <Badge label={`${item.acquire_count ?? 0} users`} variant="primary" />
                {item.share_mode && (
                  <Badge
                    label={item.share_mode}
                    variant={item.share_mode === 'copy' ? 'success' : item.share_mode === 'subscribe' ? 'primary' : 'neutral'}
                  />
                )}
              </View>
              {item.tags && item.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {item.tags.slice(0, 4).map((tag: string) => (
                    <Text key={tag} style={[theme.typography.caption, styles.tag, { color: theme.colors.textSecondary, backgroundColor: theme.colors.surface }]}>
                      #{tag}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          </ListCard>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🏪</Text>
              <Text style={[theme.typography.h3, { color: theme.colors.text, textAlign: 'center' }]}>
                No decks found
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                Try a different search or category
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 },
  listEmpty: { flex: 1 },
  header: { gap: 12, paddingTop: 16, paddingBottom: 8 },
  categoryRow: { gap: 8 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  listingContent: { gap: 6 },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 },
  emptyIcon: { fontSize: 48 },
})
