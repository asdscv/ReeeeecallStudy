import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { Screen, DrawerHeader } from '../components/ui'
import { useTheme, palette } from '../theme'
import { getMobileSupabase } from '../adapters'
import type { MainTabParamList } from '../navigation/types'

type ShareMode = 'copy' | 'subscribe' | 'snapshot'
type ShareStatus = 'pending' | 'active' | 'revoked' | 'declined'

interface DeckShare {
  id: string
  deck_id: string
  owner_id: string
  recipient_id: string | null
  share_mode: ShareMode
  status: ShareStatus
  invite_code: string | null
  invite_email: string | null
  accepted_at: string | null
  created_at: string
}

interface DeckInfo {
  id: string
  name: string
  icon: string
}

interface ShareGroup {
  deck: DeckInfo
  shares: DeckShare[]
  activeCount: number
  pendingCount: number
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: 'Pending', bg: '#FFFBEB', text: '#B45309' },
  active: { label: 'Active', bg: '#F0FDF4', text: '#15803D' },
  revoked: { label: 'Revoked', bg: '#FEF2F2', text: '#DC2626' },
  declined: { label: 'Declined', bg: '#F3F4F6', text: '#6B7280' },
}

const MODE_LABELS: Record<string, string> = {
  copy: 'Copy',
  subscribe: 'Subscribe',
  snapshot: 'Snapshot',
}

export function MySharesScreen() {
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<MainTabParamList>>()

  const [sentShares, setSentShares] = useState<DeckShare[]>([])
  const [receivedShares, setReceivedShares] = useState<DeckShare[]>([])
  const [deckMap, setDeckMap] = useState<Record<string, DeckInfo>>({})
  const [loading, setLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const supabase = getMobileSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Fetch sent shares
    const { data: sent } = await supabase
      .from('deck_shares')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    // Fetch received shares
    const { data: received } = await supabase
      .from('deck_shares')
      .select('*')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })

    const allShares = [...(sent ?? []), ...(received ?? [])] as DeckShare[]
    const deckIds = [...new Set(allShares.map((s) => s.deck_id))]

    if (deckIds.length > 0) {
      const { data: decks } = await supabase
        .from('decks')
        .select('id, name, icon')
        .in('id', deckIds)

      const map: Record<string, DeckInfo> = {}
      for (const d of decks ?? []) {
        map[d.id] = { id: d.id, name: d.name, icon: d.icon ?? '📚' }
      }
      setDeckMap(map)
    }

    setSentShares((sent ?? []) as DeckShare[])
    setReceivedShares((received ?? []) as DeckShare[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleRevoke = (shareId: string) => {
    Alert.alert('Revoke Access', 'Are you sure you want to revoke this share?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          const supabase = getMobileSupabase()
          await supabase
            .from('deck_shares')
            .update({ status: 'revoked' } as Record<string, unknown>)
            .eq('id', shareId)
          await fetchAll()
        },
      },
    ])
  }

  const handleUnsubscribe = (shareId: string) => {
    Alert.alert('Unsubscribe', 'Are you sure you want to unsubscribe from this deck?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsubscribe',
        style: 'destructive',
        onPress: async () => {
          const supabase = getMobileSupabase()
          await supabase
            .from('deck_shares')
            .update({ status: 'revoked' } as Record<string, unknown>)
            .eq('id', shareId)
          await fetchAll()
        },
      },
    ])
  }

  const navigateToShareDeck = (deckId: string) => {
    navigation.navigate('DecksTab', { screen: 'ShareDeck', params: { deckId } } as any)
  }

  // Group sent shares by deck
  const sentGroups: ShareGroup[] = []
  const groupedByDeck: Record<string, DeckShare[]> = {}
  for (const share of sentShares) {
    if (!groupedByDeck[share.deck_id]) groupedByDeck[share.deck_id] = []
    groupedByDeck[share.deck_id].push(share)
  }
  for (const [deckId, shares] of Object.entries(groupedByDeck)) {
    const deck = deckMap[deckId] ?? { id: deckId, name: 'Unknown Deck', icon: '📚' }
    sentGroups.push({
      deck,
      shares,
      activeCount: shares.filter((s) => s.status === 'active').length,
      pendingCount: shares.filter((s) => s.status === 'pending').length,
    })
  }

  const renderShareItem = (share: DeckShare, type: 'sent' | 'received') => {
    const status = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.pending
    return (
      <View
        key={share.id}
        style={[styles.shareRow, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
        testID={`my-share-${share.id}`}
      >
        <View style={styles.shareInfo}>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]} numberOfLines={1}>
            {share.invite_email || share.invite_code || 'Invite Link'}
          </Text>
          <View style={styles.shareMeta}>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {MODE_LABELS[share.share_mode] ?? share.share_mode}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
            </View>
          </View>
        </View>
        {share.status === 'active' && (
          <TouchableOpacity
            onPress={() => type === 'sent' ? handleRevoke(share.id) : handleUnsubscribe(share.id)}
            style={styles.actionBtn}
            testID={`my-share-action-${share.id}`}
          >
            <Text style={[theme.typography.caption, { color: palette.red[500] }]}>
              {type === 'sent' ? 'Revoke' : 'Unsubscribe'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <Screen safeArea padding={false} testID="my-shares-screen">
      <DrawerHeader title="My Shares" />
      <FlatList
        data={[1]} // single item, we render sections manually
        keyExtractor={() => 'sections'}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchAll} />}
        contentContainerStyle={styles.list}
        renderItem={() => (
          <View style={styles.sections}>
            {/* Sent Shares */}
            <View style={styles.section}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Shared by You</Text>

              {sentGroups.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                  <Text style={{ fontSize: 32, textAlign: 'center' }}>📤</Text>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                    You haven't shared any decks yet.
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
                    Go to a deck and tap "Share" to create an invite link.
                  </Text>
                </View>
              ) : (
                sentGroups.map((group) => (
                  <View key={group.deck.id} style={[styles.groupCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                    <TouchableOpacity
                      onPress={() => navigateToShareDeck(group.deck.id)}
                      style={styles.groupHeader}
                      testID={`my-share-group-${group.deck.id}`}
                    >
                      <Text style={styles.groupIcon}>{group.deck.icon}</Text>
                      <View style={styles.groupInfo}>
                        <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                          {group.deck.name}
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                          {group.activeCount} active · {group.pendingCount} pending
                        </Text>
                      </View>
                      <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
                    </TouchableOpacity>
                    <View style={[styles.groupDivider, { borderTopColor: theme.colors.border }]} />
                    {group.shares.slice(0, 3).map((share) => renderShareItem(share, 'sent'))}
                    {group.shares.length > 3 && (
                      <TouchableOpacity
                        onPress={() => navigateToShareDeck(group.deck.id)}
                        style={styles.viewAllBtn}
                      >
                        <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                          View all {group.shares.length} shares
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </View>

            {/* Received Shares */}
            <View style={styles.section}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Shared with You</Text>

              {receivedShares.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
                  <Text style={{ fontSize: 32, textAlign: 'center' }}>📥</Text>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                    No one has shared a deck with you yet.
                  </Text>
                </View>
              ) : (
                receivedShares.map((share) => {
                  const deck = deckMap[share.deck_id]
                  return (
                    <View key={share.id}>
                      {deck && (
                        <View style={styles.receivedDeckRow}>
                          <Text style={styles.groupIcon}>{deck.icon}</Text>
                          <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]} numberOfLines={1}>
                            {deck.name}
                          </Text>
                        </View>
                      )}
                      {renderShareItem(share, 'received')}
                    </View>
                  )
                })
              )}
            </View>
          </View>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  sections: { gap: 24, paddingTop: 16 },
  section: { gap: 8 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 24, gap: 8 },
  groupCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  groupIcon: { fontSize: 24 },
  groupInfo: { flex: 1, gap: 2 },
  groupDivider: { borderTopWidth: 1 },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, marginHorizontal: 8, marginVertical: 2, borderRadius: 8, borderWidth: 1 },
  shareInfo: { flex: 1, gap: 4 },
  shareMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '500' },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  viewAllBtn: { alignItems: 'center', paddingVertical: 10 },
  receivedDeckRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 4 },
})
