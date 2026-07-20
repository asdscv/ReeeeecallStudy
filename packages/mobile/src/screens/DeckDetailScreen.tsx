import { useState, useMemo, useCallback, useEffect } from 'react'
import { View, Text, FlatList, RefreshControl, Alert, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, FAB, EmptyState, Badge, ListCard, SearchBar, ScreenHeader, ListSkeleton } from '../components/ui'
import { toast } from '../stores/toast-store'
import { UploadDateTab } from '../components/deck/UploadDateTab'
import { DeckStatsTab } from '../components/deck/DeckStatsTab'
import { VersionHistoryTab } from '../components/deck/VersionHistoryTab'
import { useDecks } from '../hooks/useDecks'
import { useCards } from '../hooks/useCards'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { useSyncStore } from '@reeeeecall/shared/stores/sync-store'
import type { DeckShare } from '@reeeeecall/shared/types/database'
import { getMobileSupabase } from '../adapters'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'DeckDetail'>
type Route = RouteProp<DecksStackParamList, 'DeckDetail'>

type TabKey = 'cards' | 'dates' | 'stats' | 'versions'

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'cards', labelKey: 'detail.tabs.cardList' },
  { key: 'dates', labelKey: 'detail.tabs.uploadDate' },
  { key: 'stats', labelKey: 'detail.tabs.statistics' },
  { key: 'versions', labelKey: 'deckDetail.tabVersions' },
]

const STATUS_FILTERS = ['all', 'new', 'learning', 'review', 'suspended'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const CARDS_PER_PAGE_OPTIONS = [10, 20, 50] as const

export function DeckDetailScreen() {
  const theme = useTheme()
  const { t } = useTranslation(['decks', 'marketplace', 'sharing'])
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const { deckId } = route.params

  const { decks, getStatsForDeck, deleteDeck } = useDecks()
  const { cards, loading, refresh, deleteCard, deleteCards } = useCards(deckId)
  const { pendingCounts, syncing, syncSubscribedDeck, fetchPendingCount } = useSyncStore()

  const [activeTab, setActiveTab] = useState<TabKey>('cards')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Deck ownership for versions tab
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  useEffect(() => {
    getMobileSupabase().auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
  }, [])

  // Bulk selection state
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [cardsPerPage, setCardsPerPage] = useState(20)

  // Subscription sync state
  const [subscription, setSubscription] = useState<DeckShare | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  // Card-limit archive state (mig 123). `activeThreshold` is the account-wide
  // boundary created_at: a card is ARCHIVED-from-study iff it's owned,
  // non-official, and created_at > threshold (NULL threshold = not over limit →
  // nothing archived). `archivedCount` is this deck's archived count (server is
  // the authority; both are auth.uid()-scoped SECURITY DEFINER RPCs). We only
  // BADGE archived cards — they stay fully viewable/editable/deletable.
  const [activeThreshold, setActiveThreshold] = useState<string | null>(null)
  const [archivedCount, setArchivedCount] = useState(0)

  const deck = decks.find((d) => d.id === deckId)
  const deckStats = getStatsForDeck(deckId)
  const isSubscribed = !!subscription
  const pendingCount = pendingCounts[deckId] ?? 0
  const isSyncing = syncing[deckId] ?? false

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

  // Reset to page 1 when search/filter/cardsPerPage changes
  useEffect(() => {
    setCurrentPage(1)
  }, [search, statusFilter, cardsPerPage])

  // Check if this is a subscribed deck
  useEffect(() => {
    const checkSubscription = async () => {
      const sb = getMobileSupabase()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return
      const { data } = await sb
        .from('deck_shares')
        .select('*')
        .eq('deck_id', deckId)
        .eq('recipient_id', user.id)
        .eq('share_mode', 'subscribe')
        .eq('status', 'active')
        .limit(1)
        .single()
      if (data) {
        setSubscription(data as DeckShare)
        fetchPendingCount(deckId)
      }
    }
    checkSubscription()
  }, [deckId, fetchPendingCount])

  // Fetch the account-wide archive boundary + this deck's archived count. The
  // boundary shifts when the card set changes (adding cards past the limit, or
  // deleting/subscribing to free some up), so re-run on card-count changes to
  // keep the badge + note in sync. Errors fail closed (null threshold / 0
  // count) → nothing shown, which is the safe "not over limit" state.
  const fetchArchiveState = useCallback(async () => {
    const sb = getMobileSupabase()
    const [thresholdRes, countRes] = await Promise.all([
      sb.rpc('get_active_card_threshold'),
      sb.rpc('get_deck_archived_count', { p_deck_id: deckId }),
    ])
    setActiveThreshold((thresholdRes.data as string | null) ?? null)
    setArchivedCount((countRes.data as number | null) ?? 0)
  }, [deckId])

  useEffect(() => {
    void fetchArchiveState()
  }, [fetchArchiveState, cards.length])

  const handleSync = useCallback(async () => {
    setSyncMessage(null)
    const result = await syncSubscribedDeck(deckId)
    if (result) {
      if (result.added === 0 && result.removed === 0) {
        setSyncMessage(t('sync.noChanges'))
      } else {
        setSyncMessage(t('sync.syncComplete', { added: result.added, removed: result.removed }))
      }
      refresh()
    } else {
      setSyncMessage(t('sync.syncFailed'))
    }
    setTimeout(() => setSyncMessage(null), 5000)
  }, [deckId, syncSubscribedDeck, t, refresh])

  const handleRefreshWithSync = useCallback(async () => {
    if (isSubscribed) {
      await handleSync()
    }
    refresh()
  }, [isSubscribed, handleSync, refresh])

  const handleUnsubscribe = useCallback(() => {
    Alert.alert(
      t('sharing:unsubscribe', { defaultValue: 'Unsubscribe' }),
      t('marketplace:detail.unsubscribeConfirm', {
        defaultValue:
          'Unsubscribe from this deck? Your personal study progress for it will remain in your account.',
      }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('sharing:unsubscribe', { defaultValue: 'Unsubscribe' }),
          style: 'destructive',
          onPress: async () => {
            const supabase = getMobileSupabase()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: shareRow } = await supabase
              .from('deck_shares')
              .select('id')
              .eq('deck_id', deckId)
              .eq('recipient_id', user.id)
              .eq('share_mode', 'subscribe')
              .eq('status', 'active')
              .limit(1)
              .maybeSingle()
            const id = (shareRow as { id?: string } | null)?.id
            if (!id) {
              toast.error(t('marketplace:detail.unsubscribeError', { defaultValue: 'Failed to unsubscribe.' }))
              return
            }
            const { error } = await supabase
              .from('deck_shares')
              .update({ status: 'revoked' })
              .eq('id', id)
            if (error) {
              // Never surface the raw DB message to the user.
              toast.error(t('marketplace:detail.unsubscribeError', { defaultValue: 'Failed to unsubscribe.' }))
              return
            }
            toast.success(t('sharing:unsubscribed', { defaultValue: 'Unsubscribed' }))
            navigation.goBack()
          },
        },
      ],
    )
  }, [deckId, navigation, t])

  // Exit selection mode clears selections
  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  // Pagination computed values
  const totalPages = Math.max(1, Math.ceil(filteredCards.length / cardsPerPage))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedCards = useMemo(() => {
    const start = (safePage - 1) * cardsPerPage
    return filteredCards.slice(start, start + cardsPerPage)
  }, [filteredCards, safePage, cardsPerPage])

  // Keep currentPage in bounds when filteredCards shrinks
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    const allFilteredIds = filteredCards.map((c) => c.id)
    const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id))
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allFilteredIds))
    }
  }, [filteredCards, selectedIds])

  const allSelected = filteredCards.length > 0 && filteredCards.every((c) => selectedIds.has(c.id))

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size
    if (count === 0) return
    Alert.alert(
      t('deckDetail.deleteCardsTitle'),
      t('deckDetail.deleteCardsConfirm', { count }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteCards(Array.from(selectedIds))
            exitSelectionMode()
            refresh()
          },
        },
      ],
    )
  }, [selectedIds, deleteCards, exitSelectionMode, refresh, t])

  // A card is archived-from-study iff it's past the account boundary (strict >,
  // matching the server: boundary ties stay ACTIVE). NULL threshold = not over
  // limit → nothing archived. Compared as epoch ms to be timezone/format-safe.
  const isCardArchived = useCallback(
    (createdAt: string) =>
      activeThreshold != null &&
      new Date(createdAt).getTime() > new Date(activeThreshold).getTime(),
    [activeThreshold],
  )

  if (!deck) {
    return (
      <Screen testID="deck-detail-screen">
        <ScreenHeader title={t('detail.backToList')} mode="back" />
        <EmptyState icon="❓" title={t('detail.deckNotFound')} />
      </Screen>
    )
  }

  const totalCards = deckStats?.total_cards ?? cards.length
  const dueCards = (deckStats?.review_cards ?? 0) + (deckStats?.learning_cards ?? 0)
  const newCards = deckStats?.new_cards ?? 0

  const handleDeleteDeck = () => {
    Alert.alert(t('deleteDeck'), t('deleteConfirm', { name: deck.name }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => { await deleteDeck(deckId); navigation.goBack() } },
    ])
  }

  const renderSelectionBar = () => {
    if (!selectionMode) return null
    return (
      <View style={[styles.selectionBar, { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.border }]}>
        <View style={styles.selectionBarLeft}>
          <TouchableOpacity onPress={toggleSelectAll} style={styles.selectAllBtn} testID="bulk-select-all">
            <View style={[
              styles.checkbox,
              { borderColor: theme.colors.primary },
              allSelected && { backgroundColor: theme.colors.primary },
            ]}>
              {allSelected && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
              {allSelected ? t('deckDetail.deselectAll') : t('deckDetail.selectAll')}
            </Text>
          </TouchableOpacity>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]} testID="bulk-selection-count">
            {t('deckDetail.selectedCount', { count: selectedIds.size })}
          </Text>
        </View>
        <View style={styles.selectionBarRight}>
          {selectedIds.size > 0 && (
            <Button
              title={t('deckDetail.deleteSelected')}
              variant="danger"
              size="sm"
              fullWidth={false}
              onPress={handleBulkDelete}
              testID="bulk-delete-btn"
            />
          )}
          <Button
            title={t('cancel')}
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={exitSelectionMode}
            testID="bulk-cancel-btn"
          />
        </View>
      </View>
    )
  }

  const renderPaginationControls = () => {
    if (filteredCards.length === 0) return null
    return (
      <View style={[styles.paginationContainer, { borderTopColor: theme.colors.border }]}>
        {/* Cards per page selector */}
        <View style={styles.perPageRow}>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('deckDetail.perPage')}</Text>
          {CARDS_PER_PAGE_OPTIONS.map((opt) => {
            const active = cardsPerPage === opt
            return (
              <TouchableOpacity
                key={opt}
                onPress={() => setCardsPerPage(opt)}
                style={[
                  styles.perPageChip,
                  {
                    backgroundColor: active ? theme.colors.primary : 'transparent',
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                  },
                ]}
                testID={`per-page-${opt}`}
              >
                <Text style={[
                  theme.typography.caption,
                  { color: active ? theme.colors.primaryText : theme.colors.textSecondary },
                ]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Page navigation */}
        {totalPages > 1 && (
          <View style={styles.pageNavRow}>
            <TouchableOpacity
              onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              style={[
                styles.pageBtn,
                { borderColor: theme.colors.border, opacity: safePage <= 1 ? 0.4 : 1 },
              ]}
              testID="pagination-prev"
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>{t('deckDetail.prevPage')}</Text>
            </TouchableOpacity>

            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} testID="pagination-info">
              {t('deckDetail.pageOf', { current: safePage, total: totalPages })}
            </Text>

            <TouchableOpacity
              onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              style={[
                styles.pageBtn,
                { borderColor: theme.colors.border, opacity: safePage >= totalPages ? 0.4 : 1 },
              ]}
              testID="pagination-next"
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>{t('deckDetail.nextPage')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Summary */}
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
          {t('deckDetail.showingRange', {
            from: Math.min((safePage - 1) * cardsPerPage + 1, filteredCards.length),
            to: Math.min(safePage * cardsPerPage, filteredCards.length),
            total: filteredCards.length,
          })}
        </Text>
      </View>
    )
  }

  const renderHeader = () => (
    <View style={styles.header}>
      {/* Title: icon + name — matches web: flex items-center gap-2 */}
      <View style={styles.titleRow}>
        <Text style={styles.titleIcon}>{deck.icon}</Text>
        <Text style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>{deck.name}</Text>
        {isSubscribed && (
          <View style={[styles.subscribedBadge, { backgroundColor: theme.colors.primaryLight }]}>
            <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
              {t('sync.subscribed')}
            </Text>
          </View>
        )}
      </View>

      {deck.description && (
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{deck.description}</Text>
      )}

      {/* Sync bar for subscribed decks */}
      {isSubscribed && (
        <View style={[styles.syncBar, { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.border }]}>
          <TouchableOpacity
            onPress={handleSync}
            disabled={isSyncing}
            style={[styles.syncButton, { backgroundColor: theme.colors.primary, opacity: isSyncing ? 0.6 : 1 }]}
            testID="sync-button"
          >
            <Text style={[theme.typography.caption, { color: '#fff', fontWeight: '600' }]}>
              {isSyncing ? t('sync.syncing') : t('sync.button')}
            </Text>
          </TouchableOpacity>
          {pendingCount > 0 && (
            <View style={[styles.pendingBadge, { backgroundColor: theme.colors.errorLight }]}>
              <Text style={[theme.typography.caption, { color: theme.colors.error, fontWeight: '600' }]}>
                {t('sync.pendingChanges', { count: pendingCount })}
              </Text>
            </View>
          )}
          <Text style={[theme.typography.caption, { color: theme.colors.primary, flex: 1 }]}>
            {subscription?.last_synced_at
              ? t('sync.lastSynced', { time: new Date(subscription.last_synced_at).toLocaleDateString() })
              : t('sync.neverSynced')}
          </Text>
          {syncMessage && (
            <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
              {syncMessage}
            </Text>
          )}
        </View>
      )}

      {/* Stats badges — matches web: flex-wrap gap-2 */}
      <View style={styles.badgeRow}>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('detail.totalCards', { count: totalCards })}</Text>
        {newCards > 0 && <Text style={[theme.typography.caption, { color: palette.blue[600] }]}>{t('detail.newCards', { count: newCards })}</Text>}
        {dueCards > 0 && <Text style={[theme.typography.caption, { color: palette.yellow[600] }]}>{t('detail.reviewCards', { count: dueCards })}</Text>}
      </View>

      {/* Archived-over-limit note — cards stay viewable; study is gated behind a
          subscription. Subscribe CTA is a disabled placeholder until payment
          (mirrors CardLimitNotice / settings card-usage). */}
      {archivedCount > 0 && (
        <View
          style={[styles.archivedNote, { backgroundColor: theme.colors.warning + '1A', borderColor: theme.colors.warning }]}
          testID="deck-archived-note"
        >
          <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
            {t('deckDetail.archivedNote', { count: archivedCount })}
          </Text>
          <Button
            title={t('deckDetail.archivedSubscribe')}
            onPress={() => {}}
            disabled
            variant="outline"
            size="sm"
            fullWidth={false}
            testID="deck-archived-subscribe"
          />
        </View>
      )}

      {/* Action buttons — matches web: Study, Edit, Share, Add Card, AI Cards, Import, Export */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionScroll}>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionPill, styles.actionPillPrimary]}
            onPress={() => {
              const tabNav = navigation.getParent()
              if (tabNav) {
                tabNav.navigate('StudyTab', { screen: 'StudySetup', params: { deckId } })
              }
            }}
            testID="deck-detail-study"
          >
            <Text style={[theme.typography.caption, styles.actionPillPrimaryText]}>{t('detail.startStudy')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionPill, { borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate('DeckEdit', { deckId })}
            testID="deck-detail-edit"
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('detail.edit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionPill, { borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate('ShareDeck', { deckId })}
            testID="deck-detail-share"
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('detail.share')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionPill, { borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate('CardEdit', { deckId })}
            testID="deck-detail-add-card"
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('detail.addCard')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionPill, { borderColor: theme.colors.border }]}
            onPress={() => {
              const tabNav = navigation.getParent()
              if (tabNav) {
                tabNav.navigate('SettingsTab', { screen: 'AIGenerate' })
              }
            }}
            testID="deck-detail-ai-cards"
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('detail.aiCards')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionPill, { borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate('ImportExport', { deckId })}
            testID="deck-detail-import"
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('detail.import')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionPill, { borderColor: theme.colors.border }]}
            onPress={() => navigation.navigate('ImportExport', { deckId })}
            testID="deck-detail-export"
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('detail.export')}</Text>
          </TouchableOpacity>
          {!selectionMode && filteredCards.length > 0 && (
            <TouchableOpacity
              style={[styles.actionPill, { borderColor: theme.colors.border }]}
              onPress={() => setSelectionMode(true)}
              testID="bulk-select-toggle"
            >
              <Text style={[theme.typography.caption, { color: theme.colors.text }]}>{t('deckDetail.selectMode')}</Text>
            </TouchableOpacity>
          )}
          {isSubscribed && (
            <TouchableOpacity
              style={[styles.actionPill, { borderColor: theme.colors.error }]}
              onPress={handleUnsubscribe}
              testID="deck-detail-unsubscribe"
              accessibilityLabel={t('sharing:unsubscribe', { defaultValue: 'Unsubscribe' })}
            >
              <Text style={[theme.typography.caption, { color: theme.colors.error }]}>
                {t('marketplace:detail.unsubscribe', { defaultValue: 'Unsubscribe' })}
              </Text>
            </TouchableOpacity>
          )}
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
                {t(tab.labelKey)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Cards tab: search + filter chips */}
      {activeTab === 'cards' && (
        <>
          <SearchBar value={search} onChangeText={setSearch} placeholder={t('detail.searchPlaceholder')} testID="deck-detail-search" />
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
                    {t(`status.${f}`)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          {/* Selection bar */}
          {renderSelectionBar()}
        </>
      )}
    </View>
  )

  const isOwner = !!currentUserId && deck?.user_id === currentUserId

  // Non-cards tabs
  if (activeTab === 'dates' || activeTab === 'stats' || activeTab === 'versions') {
    return (
      <Screen safeArea padding={false} testID="deck-detail-screen">
        <ScreenHeader title={deck.name} mode="back" />
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading && cards.length > 0}
              onRefresh={handleRefreshWithSync}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        >
          {renderHeader()}
          <View style={styles.tabContent}>
            {activeTab === 'dates' ? (
              <UploadDateTab
                cards={cards}
                onCardPress={(cardId) => navigation.navigate('CardEdit', { deckId, cardId })}
                testID="deck-dates-tab"
              />
            ) : activeTab === 'stats' ? (
              <DeckStatsTab cards={cards} testID="deck-stats-tab" />
            ) : (
              <VersionHistoryTab deckId={deckId} isOwner={isOwner} testID="deck-versions-tab" />
            )}
          </View>
        </ScrollView>
      </Screen>
    )
  }

  // Cards tab — mobile card-based view (matches web md:hidden view)
  return (
    <Screen safeArea padding={false} testID="deck-detail-screen">
      <ScreenHeader title={deck.name} mode="back" />
      <FlatList
        data={paginatedCards}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={handleRefreshWithSync} />}
        contentContainerStyle={[styles.list, paginatedCards.length === 0 && filteredCards.length === 0 && styles.listEmpty]}
        ListHeaderComponent={renderHeader()}
        ListFooterComponent={renderPaginationControls()}
        renderItem={({ item }) => {
          const fields = Object.values(item.field_values)
          const isSelected = selectedIds.has(item.id)
          return (
            <TouchableOpacity
              onPress={() => {
                if (selectionMode) {
                  toggleSelect(item.id)
                } else {
                  navigation.navigate('CardEdit', { deckId, cardId: item.id })
                }
              }}
              onLongPress={() => {
                if (!selectionMode) {
                  setSelectionMode(true)
                  setSelectedIds(new Set([item.id]))
                }
              }}
              activeOpacity={0.7}
              style={[
                styles.cardItem,
                {
                  backgroundColor: isSelected ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                  borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                },
              ]}
              testID={`card-item-${item.id}`}
            >
              {selectionMode && (
                <View
                  style={[
                    styles.checkbox,
                    { borderColor: theme.colors.primary },
                    isSelected && { backgroundColor: theme.colors.primary },
                  ]}
                  testID={`card-checkbox-${item.id}`}
                >
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </View>
              )}
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
                    {val || t('emptyField')}
                  </Text>
                ))}
              </View>
              {isOwner && isCardArchived(item.created_at) ? (
                <Badge label={t('deckDetail.archivedBadge')} variant="warning" testID={`card-archived-${item.id}`} />
              ) : (
                <Badge label={item.srs_status} variant={
                  item.srs_status === 'new' ? 'primary' :
                  item.srs_status === 'review' ? 'success' :
                  item.srs_status === 'learning' ? 'warning' : 'neutral'
                } />
              )}
            </TouchableOpacity>
          )
        }}
        ListEmptyComponent={
          loading ? (
            <ListSkeleton count={6} />
          ) : (
            <View style={styles.emptyContainer}>
              <EmptyState
                icon="🃏"
                title={t('detail.noCards')}
                actionTitle={t('detail.addFirstCard')}
                onAction={() => navigation.navigate('CardEdit', { deckId })}
                testID="deck-detail-empty"
              />
              <View style={styles.emptyButtons}>
                <Button title={t('detail.importCards')} variant="outline" size="sm"
                  onPress={() => navigation.navigate('ImportExport', { deckId })} testID="deck-empty-import" />
                <Button title={t('detail.downloadTemplate')} variant="outline" size="sm"
                  onPress={() => navigation.navigate('ImportExport', { deckId })} testID="deck-empty-template" />
              </View>
            </View>
          )
        }
      />
      {!selectionMode && (
        <FAB onPress={() => navigation.navigate('CardEdit', { deckId })} testID="deck-detail-fab-add" />
      )}
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
  actionRow: { flexDirection: 'row', gap: 0 },
  actionPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  actionPillPrimary: {
    backgroundColor: palette.blue[600],
    borderColor: palette.blue[600],
  },
  actionPillPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  tabContent: { paddingTop: 8 },
  // Matches web mobile card view: rounded-xl border p-3
  cardItem: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  cardContent: { flex: 1, gap: 2 },
  emptyContainer: { gap: 12 },
  emptyButtons: { flexDirection: 'row', gap: 8, justifyContent: 'center' },

  // Archived-over-limit note
  archivedNote: {
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'flex-start',
  },

  // Subscription sync
  subscribedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  syncBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  syncButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pendingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },

  // Bulk selection
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    flexWrap: 'wrap',
    rowGap: 8,
  },
  selectionBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectionBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },

  // Pagination
  paginationContainer: {
    paddingTop: 12,
    paddingBottom: 4,
    gap: 10,
    borderTopWidth: 1,
    marginTop: 4,
  },
  perPageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  perPageChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  pageNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  pageBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
})
