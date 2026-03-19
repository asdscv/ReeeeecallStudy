import { useState, useEffect, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator, ScrollView } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, SearchBar, Badge, ListCard, DrawerHeader } from '../components/ui'
import { OfficialBadge } from '../components/ui/OfficialBadge'
import { testProps } from '../utils/testProps'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import { useOfficialStore } from '@reeeeecall/shared/stores/official-store'
import {
  filterListings,
  sortListings,
  calculateTrendingScore,
  getTrendingListingIds,
  type MarketplaceListingData,
  type SortBy,
  SHARE_MODES,
  DATE_RANGE_OPTIONS,
} from '@reeeeecall/shared/lib/marketplace'
import { useTranslation } from 'react-i18next'
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

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'popular', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'trending', label: 'Trending' },
  { value: 'card_count', label: 'Most Cards' },
  { value: 'top_rated', label: 'Top Rated' },
]

const DATE_LABELS: Record<string, string> = {
  '7d': 'Last 7d',
  '30d': 'Last 30d',
  '90d': 'Last 90d',
  'all': 'All time',
}

const PAGE_SIZE = 20

function renderStars(rating: number, max = 5): string {
  const filled = Math.round(rating)
  return Array.from({ length: max }, (_, i) => (i < filled ? '\u2605' : '\u2606')).join('')
}

export function MarketplaceScreen() {
  const { t } = useTranslation('marketplace')
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { listings, loading, fetchListings } = useMarketplaceStore()
  const { officialListings, listingsLoading: officialLoading, fetchOfficialListings } = useOfficialStore()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('popular')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [shareMode, setShareMode] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all' | undefined>(undefined)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => { fetchListings(); fetchOfficialListings() }, [fetchListings, fetchOfficialListings])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [search, category, sortBy, verifiedOnly, shareMode, dateRange])

  const filtered = useMemo(() => {
    const result = filterListings(listings as MarketplaceListingData[], {
      category: category || undefined,
      query: search.trim() || undefined,
      verifiedOnly: verifiedOnly || undefined,
      shareMode,
      dateRange: dateRange === 'all' ? undefined : dateRange,
    })
    return sortListings(result, sortBy) as typeof listings
  }, [listings, search, category, sortBy, verifiedOnly, shareMode, dateRange])

  const trendingIds = useMemo(() => getTrendingListingIds(listings as MarketplaceListingData[]), [listings])

  const paginatedData = filtered.slice(0, page * PAGE_SIZE)
  const hasMore = paginatedData.length < filtered.length
  const activeFilterCount = (verifiedOnly ? 1 : 0) + (shareMode ? 1 : 0) + (dateRange && dateRange !== 'all' ? 1 : 0)

  const loadMore = () => {
    if (hasMore && !loading) setPage((p) => p + 1)
  }

  return (
    <Screen safeArea padding={false} testID="marketplace-screen">
      <DrawerHeader title={t('title')} />
      <FlatList
        data={paginatedData}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchListings} />}
        contentContainerStyle={[styles.list, paginatedData.length === 0 && styles.listEmpty]}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Official Decks Featured Section */}
            {officialListings.length > 0 && (
              <View style={styles.officialSection} testID="official-decks-section">
                <Text style={[theme.typography.label, { color: theme.colors.text, marginBottom: 8 }]}>
                  {'\u2B50'} Official Decks
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.officialScroll}>
                  {officialListings.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => navigation.navigate('MarketplaceDetail', { listingId: item.id })}
                      style={[styles.officialCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
                      testID={`official-listing-${item.id}`}
                    >
                      <View style={styles.officialCardHeader}>
                        <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                          {item.title}
                        </Text>
                      </View>
                      {(item as any).owner_display_name && (
                        <View style={styles.officialPublisherRow}>
                          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                            {(item as any).owner_display_name}
                          </Text>
                          <OfficialBadge
                            badgeType={(item as any).badge_type || 'verified'}
                            badgeColor={(item as any).badge_color}
                            size="sm"
                          />
                        </View>
                      )}
                      <View style={styles.officialCardMeta}>
                        <Badge label={`${item.card_count ?? 0} cards`} variant="neutral" />
                        <Badge label={`${item.acquire_count ?? 0} users`} variant="primary" />
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <SearchBar value={search} onChangeText={setSearch} placeholder={t('searchPlaceholder')} testID="marketplace-search" />

            {/* Sort chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
              {SORT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setSortBy(opt.value)}
                  testID={`marketplace-sort-${opt.value}`}
                  style={[
                    styles.sortChip,
                    {
                      backgroundColor: sortBy === opt.value ? theme.colors.primary : theme.colors.surface,
                      borderColor: sortBy === opt.value ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[
                    theme.typography.labelSmall,
                    { color: sortBy === opt.value ? theme.colors.primaryText : theme.colors.text },
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Category filter */}
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={CATEGORIES}
              keyExtractor={(item) => item.value}
              contentContainerStyle={styles.categoryRow}
              renderItem={({ item }) => (
                <TouchableOpacity
                  {...testProps(`marketplace-cat-${item.value || 'all'}`)}
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

            {/* Verified only + Advanced toggle row */}
            <View style={styles.filterButtonRow}>
              <TouchableOpacity
                onPress={() => setVerifiedOnly(!verifiedOnly)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: verifiedOnly ? theme.colors.primaryLight : theme.colors.surface,
                    borderColor: verifiedOnly ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text style={[
                  theme.typography.labelSmall,
                  { color: verifiedOnly ? theme.colors.primary : theme.colors.text },
                ]}>
                  {'\u2713'} Verified
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowAdvanced(!showAdvanced)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: showAdvanced ? theme.colors.primaryLight : theme.colors.surface,
                    borderColor: showAdvanced ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text style={[
                  theme.typography.labelSmall,
                  { color: showAdvanced ? theme.colors.primary : theme.colors.text },
                ]}>
                  Advanced{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Advanced filters panel */}
            {showAdvanced && (
              <View style={[styles.advancedPanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                {/* Date range */}
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 6 }]}>
                  Published in
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {DATE_RANGE_OPTIONS.map((range) => {
                    const isActive = (dateRange ?? 'all') === range
                    return (
                      <TouchableOpacity
                        key={range}
                        onPress={() => setDateRange(range === 'all' ? undefined : range as '7d' | '30d' | '90d')}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                            borderColor: isActive ? theme.colors.primary : theme.colors.border,
                          },
                        ]}
                      >
                        <Text style={[
                          theme.typography.labelSmall,
                          { color: isActive ? theme.colors.primaryText : theme.colors.text },
                        ]}>
                          {DATE_LABELS[range] ?? range}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>

                {/* Share mode */}
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginTop: 10, marginBottom: 6 }]}>
                  Share mode
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  <TouchableOpacity
                    onPress={() => setShareMode(undefined)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: !shareMode ? theme.colors.primary : theme.colors.surface,
                        borderColor: !shareMode ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[
                      theme.typography.labelSmall,
                      { color: !shareMode ? theme.colors.primaryText : theme.colors.text },
                    ]}>
                      All
                    </Text>
                  </TouchableOpacity>
                  {SHARE_MODES.map((mode) => {
                    const isActive = shareMode === mode
                    return (
                      <TouchableOpacity
                        key={mode}
                        onPress={() => setShareMode(isActive ? undefined : mode)}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                            borderColor: isActive ? theme.colors.primary : theme.colors.border,
                          },
                        ]}
                      >
                        <Text style={[
                          theme.typography.labelSmall,
                          { color: isActive ? theme.colors.primaryText : theme.colors.text },
                        ]}>
                          {mode}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <ListCard
            onPress={() => navigation.navigate('MarketplaceDetail', { listingId: item.id })}
            testID={`marketplace-listing-${item.id}`}
          >
            <View style={styles.listingContent}>
              <View style={styles.titleRow}>
                {trendingIds.has(item.id) && (
                  <Text style={{ fontSize: 14, marginRight: 4 }}>{'\uD83D\uDD25'}</Text>
                )}
                <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                  {item.title}
                </Text>
              </View>
              {/* Publisher + verified badge */}
              {(item as any).owner_display_name && (
                <View style={styles.publisherRow}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {(item as any).owner_display_name}
                  </Text>
                  {(item as any).owner_is_official && (
                    <OfficialBadge
                      badgeType={(item as any).badge_type || 'verified'}
                      badgeColor={(item as any).badge_color}
                      size="sm"
                    />
                  )}
                </View>
              )}
              {item.description && (
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                  {item.description}
                </Text>
              )}
              <View style={styles.metaRow}>
                <Badge label={`${item.card_count ?? 0} cards`} variant="neutral" />
                <Badge label={`${(item as any).view_count ?? 0} views`} variant="neutral" />
                <Badge label={`${item.acquire_count ?? 0} users`} variant="primary" />
                {item.share_mode && (
                  <Badge
                    label={item.share_mode}
                    variant={item.share_mode === 'copy' ? 'success' : item.share_mode === 'subscribe' ? 'primary' : 'neutral'}
                  />
                )}
                {(item as any).review_count > 0 && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {renderStars((item as any).avg_rating ?? 0)} ({(item as any).review_count})
                  </Text>
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
        ListFooterComponent={
          hasMore ? (
            <View style={styles.loadMore}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>{'\uD83C\uDFEA'}</Text>
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
  sortRow: { gap: 8 },
  sortChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  categoryRow: { gap: 8 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  filterButtonRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipRow: { gap: 8 },
  advancedPanel: { padding: 12, borderRadius: 12, borderWidth: 1 },
  listingContent: { gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  loadMore: { paddingVertical: 16, alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 },
  emptyIcon: { fontSize: 48 },
  // Official Decks section
  officialSection: { marginBottom: 4 },
  officialScroll: { gap: 10, paddingRight: 4 },
  officialCard: {
    width: 200,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  officialCardHeader: { flexDirection: 'row', alignItems: 'center' },
  officialPublisherRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  officialCardMeta: { flexDirection: 'row', gap: 6, marginTop: 2 },
})
