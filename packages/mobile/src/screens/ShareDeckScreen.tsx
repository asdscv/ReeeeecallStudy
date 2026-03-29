import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  Share,
  StyleSheet,
} from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { Screen, Button, ScreenHeader } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useTheme, palette } from '../theme'
import { statusColors } from '@reeeeecall/shared/design-tokens/colors'
import { getMobileSupabase } from '../adapters'
import type { DecksStackParamList } from '../navigation/types'

type Route = RouteProp<DecksStackParamList, 'ShareDeck'>
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

const SHARE_MODES: { value: ShareMode; label: string; desc: string; detail: string }[] = [
  {
    value: 'copy',
    label: 'Copy',
    desc: 'Users get an editable copy',
    detail: 'The recipient gets a full copy they can edit freely. No sync with your changes.',
  },
  {
    value: 'subscribe',
    label: 'Subscribe',
    desc: 'Users get read-only, auto-updated',
    detail: 'Recipients stay in sync with your deck. They cannot edit but always have the latest.',
  },
  {
    value: 'snapshot',
    label: 'Snapshot',
    desc: 'Users get read-only copy, no updates',
    detail: 'A frozen read-only copy at the current moment. No future updates.',
  },
]

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: 'Pending', ...statusColors.pending },
  active: { label: 'Active', ...statusColors.active },
  revoked: { label: 'Revoked', ...statusColors.revoked },
  declined: { label: 'Declined', ...statusColors.declined },
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

export function ShareDeckScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const route = useRoute<Route>()
  const { deckId } = route.params

  const { decks } = useDecks()
  const deck = decks.find((d) => d.id === deckId)

  const [mode, setMode] = useState<ShareMode>('copy')
  const [creating, setCreating] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [shares, setShares] = useState<DeckShare[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchShares = useCallback(async () => {
    setLoading(true)
    const supabase = getMobileSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data, error: fetchError } = await supabase
      .from('deck_shares')
      .select('*')
      .eq('deck_id', deckId)
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setShares((data ?? []) as DeckShare[])
    }
    setLoading(false)
  }, [deckId])

  useEffect(() => { fetchShares() }, [fetchShares])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    const supabase = getMobileSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCreating(false); return }

    const inviteCode = generateInviteCode()

    const { data, error: createError } = await supabase
      .from('deck_shares')
      .insert({
        deck_id: deckId,
        owner_id: user.id,
        share_mode: mode,
        invite_code: inviteCode,
        status: 'pending',
      } as Record<string, unknown>)
      .select()
      .single()

    if (createError) {
      setError(createError.message)
      setCreating(false)
      return
    }

    const link = `https://reeeeecall.com/invite/${inviteCode}`
    setInviteLink(link)
    setCreating(false)
    await fetchShares()
  }

  const handleCopyLink = async () => {
    if (!inviteLink) return
    try {
      await Share.share({ message: inviteLink })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // User cancelled share
    }
  }

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
          await fetchShares()
        },
      },
    ])
  }

  const handleNewLink = () => {
    setInviteLink(null)
    setCopied(false)
  }

  return (
    <Screen scroll keyboard testID="share-deck-screen">
      <ScreenHeader title={deck?.name ?? 'Share Deck'} mode="back" testID="share-back" />
      <View style={styles.content}>

        {/* Deck name */}
        <View style={styles.titleRow}>
          <Text style={styles.titleIcon}>{deck?.icon ?? '📚'}</Text>
          <Text style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
            {deck?.name ?? 'Share Deck'}
          </Text>
        </View>

        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
          Share this deck privately via an invite link
        </Text>

        {error && (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.errorLight }]}>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.error }]}>{error}</Text>
          </View>
        )}

        {!inviteLink ? (
          <>
            {/* Share Mode Selection */}
            <View style={styles.section}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Share Mode</Text>
              {SHARE_MODES.map((m) => {
                const isSelected = mode === m.value
                return (
                  <TouchableOpacity
                    key={m.value}
                    testID={`share-mode-${m.value}`}
                    onPress={() => setMode(m.value)}
                    style={[
                      styles.modeCard,
                      {
                        backgroundColor: isSelected ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                        borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                  >
                    <View style={styles.modeHeader}>
                      <View style={[styles.radio, {
                        borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                      }]}>
                        {isSelected && <View style={[styles.radioInner, { backgroundColor: theme.colors.primary }]} />}
                      </View>
                      <View style={styles.modeInfo}>
                        <Text style={[theme.typography.label, { color: isSelected ? theme.colors.primary : theme.colors.text }]}>
                          {m.label}
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                          {m.desc}
                        </Text>
                      </View>
                    </View>
                    {isSelected && (
                      <Text style={[theme.typography.caption, { color: palette.blue[600], marginTop: 6 }]}>
                        {m.detail}
                      </Text>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>

            <Button
              testID="share-create-link"
              title={creating ? 'Creating...' : 'Generate Invite Link'}
              onPress={handleCreate}
              loading={creating}
            />
          </>
        ) : (
          <View style={[styles.linkCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Invite Link</Text>
            <View style={[styles.linkBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                {inviteLink}
              </Text>
            </View>
            <View style={styles.linkActions}>
              <Button
                testID="share-copy-link"
                title={copied ? 'Copied!' : 'Copy Link'}
                onPress={handleCopyLink}
                size="sm"
              />
              <Button
                testID="share-new-link"
                title="New Link"
                variant="outline"
                size="sm"
                onPress={handleNewLink}
              />
            </View>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              Anyone with this link can accept the invite and get access to the deck.
            </Text>
          </View>
        )}

        {/* Existing Shares */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            Existing Shares ({shares.length})
          </Text>

          {shares.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                No shares yet. Generate an invite link above.
              </Text>
            </View>
          ) : (
            shares.map((share) => {
              const status = STATUS_CONFIG[share.status] ?? STATUS_CONFIG.pending
              return (
                <View
                  key={share.id}
                  style={[styles.shareRow, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
                  testID={`share-item-${share.id}`}
                >
                  <View style={styles.shareInfo}>
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]} numberOfLines={1}>
                      {share.invite_email || share.invite_code || 'Invite Link'}
                    </Text>
                    <View style={styles.shareMeta}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                        {share.share_mode}
                      </Text>
                      <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                        <Text style={[styles.statusText, { color: status.text }]}>
                          {status.label}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {(share.status === 'pending' || share.status === 'active') && (
                    <TouchableOpacity
                      onPress={() => handleRevoke(share.id)}
                      style={styles.revokeBtn}
                      testID={`share-revoke-${share.id}`}
                    >
                      <Text style={[theme.typography.caption, { color: palette.red[500] }]}>Revoke</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            })
          )}
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleIcon: { fontSize: 24 },
  section: { gap: 8 },
  errorBox: { padding: 12, borderRadius: 8 },
  modeCard: { padding: 14, borderRadius: 12, gap: 4 },
  modeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  modeInfo: { flex: 1, gap: 2 },
  linkCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  linkBox: { borderRadius: 8, borderWidth: 1, padding: 12 },
  linkActions: { flexDirection: 'row', gap: 8 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 24 },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, borderWidth: 1, padding: 12 },
  shareInfo: { flex: 1, gap: 4 },
  shareMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '500' },
  revokeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
})
