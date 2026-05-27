import { useState, useEffect, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator, ScrollView, Modal } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, SearchBar, ListCard, ScreenHeader, EmptyState, ListSkeleton } from '../components/ui'
import { OfficialBadge } from '../components/ui/OfficialBadge'
import { testProps } from '../utils/testProps'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import {
  filterListings,
  sortListings,
  calculateTrendingScore,
  getTrendingListingIds,
  type MarketplaceListingData,
  type SortBy,
  SHARE_MODES,
  DATE_RANGE_OPTIONS,
  LEARNING_LANGUAGES,
  NATIVE_LANGUAGES,
  STUDY_LEVELS,
} from '@reeeeecall/shared/lib/marketplace'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import type { MarketplaceStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<MarketplaceStackParamList, 'MarketplaceHome'>

// Labels resolved via i18n (`marketplace.categories.*` / `marketplace.sort.*`)
// at render time; only value + key live here. (Previously hardcoded English.)
const CATEGORIES: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'categories.all' },
  { value: 'language', labelKey: 'categories.language' },
  { value: 'science', labelKey: 'categories.science' },
  { value: 'math', labelKey: 'categories.math' },
  { value: 'history', labelKey: 'categories.history' },
  { value: 'programming', labelKey: 'categories.programming' },
  { value: 'exam', labelKey: 'categories.exam' },
  { value: 'other', labelKey: 'categories.other' },
]

const SORT_OPTIONS: { value: SortBy; labelKey: string }[] = [
  { value: 'popular', labelKey: 'sort.popular' },
  { value: 'newest', labelKey: 'sort.newest' },
  { value: 'trending', labelKey: 'sort.trending' },
  { value: 'card_count', labelKey: 'sort.cardCount' },
  { value: 'top_rated', labelKey: 'sort.topRated' },
]

const PAGE_SIZE = 20

function renderStars(rating: number, max = 5): string {
  const filled = Math.round(rating)
  return Array.from({ length: max }, (_, i) => (i < filled ? '\u2605' : '\u2606')).join('')
}

export function MarketplaceScreen() {
  const { t } = useTranslation('marketplace')
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { listings, loading, error, fetchListings } = useMarketplaceStore()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('popular')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [shareMode, setShareMode] = useState<string | undefined>(undefined)
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all' | undefined>(undefined)
  const [learningLanguage, setLearningLanguage] = useState<string | undefined>(undefined)
  const [studyLevel, setStudyLevel] = useState<string | undefined>(undefined)
  const [nativeLanguages, setNativeLanguages] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [page, setPage] = useState(1)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [sortModalOpen, setSortModalOpen] = useState(false)

  useEffect(() => { fetchListings() }, [fetchListings])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [search, category, sortBy, verifiedOnly, shareMode, dateRange, learningLanguage, studyLevel, nativeLanguages])

  const filtered = useMemo(() => {
    const result = filterListings(listings as MarketplaceListingData[], {
      category: category || undefined,
      query: search.trim() || undefined,
      verifiedOnly: verifiedOnly || undefined,
      shareMode,
      dateRange: dateRange === 'all' ? undefined : dateRange,
      learningLanguage,
      studyLevel,
      nativeLanguages,
    })
    return sortListings(result, sortBy) as typeof listings
  }, [listings, search, category, sortBy, verifiedOnly, shareMode, dateRange, learningLanguage, studyLevel, nativeLanguages])

  const toggleNativeLanguage = (lang: string) => {
    setNativeLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    )
  }

  const trendingIds = useMemo(() => getTrendingListingIds(listings as MarketplaceListingData[]), [listings])

  const paginatedData = filtered.slice(0, page * PAGE_SIZE)
  const hasMore = paginatedData.length < filtered.length
  const activeFilterCount = (verifiedOnly ? 1 : 0) + (shareMode ? 1 : 0) + (dateRange && dateRange !== 'all' ? 1 : 0) + (learningLanguage ? 1 : 0) + (studyLevel ? 1 : 0)

  const loadMore = () => {
    if (hasMore && !loading) setPage((p) => p + 1)
  }

  return (
    <Screen safeArea padding={false} testID="marketplace-screen">
      <ScreenHeader title={t('title')} mode="drawer" />
      <FlatList
        data={paginatedData}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={loading && listings.length > 0}
            onRefresh={() => fetchListings({ force: true })}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        contentContainerStyle={[styles.list, paginatedData.length === 0 && styles.listEmpty]}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={styles.header}>
            <SearchBar value={search} onChangeText={setSearch} placeholder={t('searchPlaceholder')} testID="marketplace-search" />

            {/* Category & Sort dropdowns */}
            <View style={styles.dropdownRow}>
              <TouchableOpacity
                onPress={() => setCategoryModalOpen(true)}
                style={[styles.dropdownSelector, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated }]}
                testID="marketplace-category-dropdown"
              >
                <Text style={[theme.typography.labelSmall, { color: theme.colors.text, flex: 1 }]}>
                  {(() => { const c = CATEGORIES.find((c) => c.value === category); return c ? t(c.labelKey) : t('categories.all') })()}
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>{'\u25BE'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setSortModalOpen(true)}
                style={[styles.dropdownSelector, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated }]}
                testID="marketplace-sort-dropdown"
              >
                <Text style={[theme.typography.labelSmall, { color: theme.colors.text, flex: 1 }]}>
                  {(() => { const s = SORT_OPTIONS.find((s) => s.value === sortBy); return s ? t(s.labelKey) : t('sort.popular') })()}
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
                  {'\u2713'} {t('verifiedOnly')}
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
                  {t('advancedFilters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Native language — multi-select, always visible. Lets e.g. a
                Korean learner narrow to decks explained in their language. */}
            <View>
              <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 6 }]}>
                {t('nativeLanguage.label')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {NATIVE_LANGUAGES.map((lang) => {
                  const isActive = nativeLanguages.includes(lang.value)
                  return (
                    <TouchableOpacity
                      key={lang.value}
                      testID={`marketplace-native-${lang.value}`}
                      onPress={() => toggleNativeLanguage(lang.value)}
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
                        {t(lang.labelKey)}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            </View>

            {/* Advanced filters panel */}
            {showAdvanced && (
              <View style={[styles.advancedPanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                {/* Date range */}
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginBottom: 6 }]}>
                  {t('dateRange.label')}
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
                          {t(`dateRange.${range}`)}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>

                {/* Share mode */}
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginTop: 10, marginBottom: 6 }]}>
                  {t('shareMode.label')}
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
                      {t('shareMode.all')}
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
                          {t(`shareMode.${mode}`)}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>

                {/* Learning language */}
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginTop: 10, marginBottom: 6 }]}>
                  {t('learningLanguage.label')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  <TouchableOpacity
                    onPress={() => setLearningLanguage(undefined)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: !learningLanguage ? theme.colors.primary : theme.colors.surface,
                        borderColor: !learningLanguage ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[
                      theme.typography.labelSmall,
                      { color: !learningLanguage ? theme.colors.primaryText : theme.colors.text },
                    ]}>
                      {t('learningLanguage.all')}
                    </Text>
                  </TouchableOpacity>
                  {LEARNING_LANGUAGES.map((lang) => {
                    const isActive = learningLanguage === lang.value
                    return (
                      <TouchableOpacity
                        key={lang.value}
                        onPress={() => setLearningLanguage(isActive ? undefined : lang.value)}
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
                          {t(lang.labelKey)}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>

                {/* Study level */}
                <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary, marginTop: 10, marginBottom: 6 }]}>
                  {t('studyLevel.label')}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  <TouchableOpacity
                    onPress={() => setStudyLevel(undefined)}
                    testID="marketplace-level-all"
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: !studyLevel ? theme.colors.primary : theme.colors.surface,
                        borderColor: !studyLevel ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[
                      theme.typography.labelSmall,
                      { color: !studyLevel ? theme.colors.primaryText : theme.colors.text },
                    ]}>
                      {t('studyLevel.all')}
                    </Text>
                  </TouchableOpacity>
                  {STUDY_LEVELS.map((lvl) => {
                    const isActive = studyLevel === lvl.value
                    return (
                      <TouchableOpacity
                        key={lvl.value}
                        testID={`marketplace-level-${lvl.value}`}
                        onPress={() => setStudyLevel(isActive ? undefined : lvl.value)}
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
                          {t(lvl.labelKey)}
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
                    {t(`shareMode.${item.share_mode}`, { defaultValue: item.share_mode })}
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
          loading ? (
            <ListSkeleton count={5} />
          ) : error ? (
            <EmptyState
              icon="\u26A0\uFE0F"
              title={t('loadError', { defaultValue: "Couldn't load decks" })}
              description={t('loadErrorHint', { defaultValue: 'Check your connection and try again.' })}
              actionTitle={t('common:actions.retry', { defaultValue: 'Retry' })}
              onAction={() => fetchListings({ force: true })}
            />
          ) : (
            <EmptyState
              icon="\uD83C\uDFEA"
              title={t('noResults', { defaultValue: 'No decks found' })}
              description={t('noResultsHint', { defaultValue: 'Try a different search or category' })}
            />
          )
        }
      />

      {/* Category picker modal */}
      <Modal visible={categoryModalOpen} transparent animationType="fade" onRequestClose={() => setCategoryModalOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCategoryModalOpen(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{t('categoryTitle', { defaultValue: 'Category' })}</Text>
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
                      {t(cat.labelKey)}
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
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{t('sortTitle', { defaultValue: 'Sort By' })}</Text>
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
                      {t(opt.labelKey)}
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
})
