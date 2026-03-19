import { useEffect } from 'react'
import { View, Text, FlatList, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, Badge, ListCard } from '../components/ui'
import { usePublisherStore } from '@reeeeecall/shared/stores/publisher-store'
import { useTheme } from '../theme'

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function PublisherStatsScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const { stats, loading, fetchPublisherStats } = usePublisherStore()

  useEffect(() => {
    fetchPublisherStats()
  }, [fetchPublisherStats])

  type ListItem =
    | { type: 'header'; key: string }
    | { type: 'listing'; key: string; data: NonNullable<typeof stats>['listings'][number] }
    | { type: 'activity-header'; key: string }
    | { type: 'acquire'; key: string; data: NonNullable<typeof stats>['recent_acquires'][number] }

  const items: ListItem[] = []
  items.push({ type: 'header', key: 'header' })

  if (stats?.listings) {
    for (const listing of stats.listings) {
      items.push({ type: 'listing', key: `listing-${listing.id}`, data: listing })
    }
  }

  if (stats?.recent_acquires && stats.recent_acquires.length > 0) {
    items.push({ type: 'activity-header', key: 'activity-header' })
    for (const acq of stats.recent_acquires) {
      items.push({ type: 'acquire', key: `acquire-${acq.id}`, data: acq })
    }
  }

  return (
    <Screen safeArea padding={false} testID="publisher-stats-screen">
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchPublisherStats} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          switch (item.type) {
            case 'header':
              return (
                <View style={styles.headerSection}>
                  <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                      {'< Back'}
                    </Text>
                  </TouchableOpacity>

                  <Text style={[theme.typography.h2, { color: theme.colors.text, marginBottom: 16 }]}>
                    Publisher Dashboard
                  </Text>

                  {/* Overview stats cards */}
                  <View style={styles.statsGrid}>
                    <View style={[styles.statCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                      <Text style={[styles.statEmoji]}>📊</Text>
                      <Text style={[styles.statValue, { color: theme.colors.text }]}>
                        {formatNumber(stats?.total_listings ?? 0)}
                      </Text>
                      <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Listings</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                      <Text style={[styles.statEmoji]}>👁</Text>
                      <Text style={[styles.statValue, { color: theme.colors.text }]}>
                        {formatNumber(stats?.total_views ?? 0)}
                      </Text>
                      <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Views</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                      <Text style={[styles.statEmoji]}>📥</Text>
                      <Text style={[styles.statValue, { color: theme.colors.text }]}>
                        {formatNumber(stats?.total_acquires ?? 0)}
                      </Text>
                      <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Acquires</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                      <Text style={[styles.statEmoji]}>📈</Text>
                      <Text style={[styles.statValue, { color: theme.colors.text }]}>
                        {stats?.avg_conversion_rate ?? 0}%
                      </Text>
                      <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Conv.</Text>
                    </View>
                  </View>

                  {stats?.listings && stats.listings.length > 0 && (
                    <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 20 }]}>
                      Your Listings
                    </Text>
                  )}
                </View>
              )

            case 'listing':
              return (
                <ListCard testID={`publisher-listing-${item.data.id}`}>
                  <View style={styles.listingContent}>
                    <View style={styles.listingHeader}>
                      <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                        {item.data.title}
                      </Text>
                      <Badge
                        label={item.data.is_active ? 'Active' : 'Inactive'}
                        variant={item.data.is_active ? 'success' : 'neutral'}
                      />
                    </View>
                    <View style={styles.listingStats}>
                      <Badge label={`${formatNumber(item.data.view_count)} views`} variant="neutral" />
                      <Badge label={`${formatNumber(item.data.acquire_count)} acquires`} variant="primary" />
                      <Badge label={`${item.data.conversion_rate}% conv`} variant="neutral" />
                      {item.data.avg_rating > 0 && (
                        <Badge label={`${'★'} ${item.data.avg_rating.toFixed(1)}`} variant="neutral" />
                      )}
                    </View>
                  </View>
                </ListCard>
              )

            case 'activity-header':
              return (
                <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 20, marginBottom: 8 }]}>
                  Recent Acquisitions
                </Text>
              )

            case 'acquire':
              return (
                <View style={[styles.activityItem, { borderBottomColor: theme.colors.border }]}>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                    <Text style={{ fontWeight: '600' }}>{item.data.user_name || 'Anonymous'}</Text>
                    {' acquired '}
                    <Text style={{ fontWeight: '600' }}>{item.data.deck_title}</Text>
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {timeAgo(item.data.accepted_at)}
                  </Text>
                </View>
              )

            default:
              return null
          }
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={{ fontSize: 48 }}>📊</Text>
              <Text style={[theme.typography.h3, { color: theme.colors.text, textAlign: 'center' }]}>
                No Published Listings
              </Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                Publish a deck to start tracking stats.
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  headerSection: { paddingTop: 8, paddingBottom: 8 },
  backButton: { paddingVertical: 8, marginBottom: 8 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: '44%',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  statEmoji: { fontSize: 20 },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  listingContent: { gap: 6 },
  listingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listingStats: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 40,
    marginTop: 40,
  },
})
