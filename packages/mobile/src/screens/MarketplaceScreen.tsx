import { useState, useEffect, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator, ScrollView, Modal } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, SearchBar, Badge, ListCard, ScreenHeader } from '../components/ui'
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
import { useTheme, palette } from '../theme'
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
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [sortModalOpen, setSortModalOpen] = useState(false)

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
      <ScreenHeader title={t('title')} mode="drawer" />
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

            {/* Category & Sort dropdowns */}
            <View style={styles.dropdownRow}>
              <TouchableOpacity
                onPress={() => setCategoryModalOpen(true)}
                style={[styles.dropdownSelector, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated }]}
                testID="marketplace-category-dropdown"
              >
                <Text style={[theme.typography.labelSmall, { color: theme.colors.text, flex: 1 }]}>
                  {CATEGORIES.find((c) => c.value === category)?.label ?? 'All Categories'}
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>{'\u25BE'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setSortModalOpen(true)}
                style={[styles.dropdownSelector, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated }]}
                testID="marketplace-sort-dropdown"
              >
                <Text style={[theme.typography.labelSmall, { color: theme.colors.text, flex: 1 }]}>
                  {SORT_OPTIONS.find((s) => s.value === sortBy)?.label ?? 'Popular'}
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>{'\u25BE'}</Text>
              </TouchableOpacity>
            </View>

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
              {/* Title row: icon + title (left) | action link (right) */}
              <View style={styles.titleRow}>
                <View style={styles.titleLeft}>
                  {trendingIds.has(item.id) && (
                    <Text style={{ fontSize: 14, marginRight: 4 }}>{'\uD83D\uDD25'}</Text>
                  )}
                  <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
                {item.share_mode && (
                  <Text style={[theme.typography.labelSmall, { color: theme.colors.primary }]}>
                    {item.share_mode === 'subscribe' ? 'Subscribe' : item.share_mode === 'copy' ? 'Copy' : item.share_mode}
                  </Text>
                )}
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

              {/* Description */}
              {item.description && (
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                  {item.description}
                </Text>
              )}

              {/* Tag pills */}
              {item.tags && item.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {item.tags.slice(0, 4).map((tag: string) => (
                    <View key={tag} style={[styles.tagPill, { backgroundColor: theme.colors.surface }]}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Divider */}
              <View style={[styles.listingDivider, { backgroundColor: theme.colors.border }]} />

              {/* Bottom stats: "X cards · 👁 Y · Z users" */}
              <View style={styles.statsRow}>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {item.card_count ?? 0} cards{' · '}{'\uD83D\uDC41'} {(item as any).view_count ?? 0}{' · '}{item.acquire_count ?? 0} users
                </Text>
                {(item as any).review_count > 0 && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {renderStars((item as any).avg_rating ?? 0)} ({(item as any).review_count})
                  </Text>
                )}
              </View>
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

      {/* Category picker modal */}
      <Modal visible={categoryModalOpen} transparent animationType="fade" onRequestClose={() => setCategoryModalOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCategoryModalOpen(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Category</Text>
            <FlatList
              data={CATEGORIES}
              keyExtractor={(item) => item.value || '_all'}
              renderItem={({ item: cat }) => {
                const isActive = category === cat.value
                return (
                  <TouchableOpacity
                    testID={`marketplace-cat-${cat.value || 'all'}`}
                    onPress={() => { setCategory(cat.value); setCategoryModalOpen(false) }}
                    style={[styles.modalItem, isActive && { backgroundColor: theme.colors.primaryLight }]}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.modalItemText, { color: isActive ? theme.colors.primary : theme.colors.text }]}>
                      {cat.label}
                    </Text>
                    {isActive && <Text style={{ color: theme.colors.primary, fontSize: 16 }}>{'\u2713'}</Text>}
                  </TouchableOpacity>
                )
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Sort picker modal */}
      <Modal visible={sortModalOpen} transparent animationType="fade" onRequestClose={() => setSortModalOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSortModalOpen(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Sort By</Text>
            <FlatList
              data={SORT_OPTIONS}
              keyExtractor={(item) => item.value}
              renderItem={({ item: opt }) => {
                const isActive = sortBy === opt.value
                return (
                  <TouchableOpacity
                    testID={`marketplace-sort-${opt.value}`}
                    onPress={() => { setSortBy(opt.value); setSortModalOpen(false) }}
                    style={[styles.modalItem, isActive && { backgroundColor: theme.colors.primaryLight }]}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.modalItemText, { color: isActive ? theme.colors.primary : theme.colors.text }]}>
                      {opt.label}
                    </Text>
                    {isActive && <Text style={{ color: theme.colors.primary, fontSize: 16 }}>{'\u2713'}</Text>}
                  </TouchableOpacity>
                )
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 },
  listEmpty: { flex: 1 },
  header: { gap: 12, paddingTop: 16, paddingBottom: 8 },
  dropdownRow: { flexDirection: 'row', gap: 10 },
  dropdownSelector: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center', padding: 40,
  },
  modalContent: {
    width: '100%', maxWidth: 320, borderRadius: 16,
    paddingVertical: 12, maxHeight: 400,
  },
  modalTitle: {
    fontSize: 16, fontWeight: '600', paddingHorizontal: 20, paddingVertical: 12,
  },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  modalItemText: { flex: 1, fontSize: 15, fontWeight: '500' },
  filterButtonRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipRow: { gap: 8 },
  advancedPanel: { padding: 12, borderRadius: 12, borderWidth: 1 },
  listingContent: { gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  tagPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  listingDivider: { height: StyleSheet.hairlineWidth, marginTop: 6 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
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
