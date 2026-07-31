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
import { useTranslation } from 'react-i18next'
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

const SHARE_MODES: { value: ShareMode; labelKey: string; descKey: string; detailKey: string }[] = [
  {
    value: 'copy',
    labelKey: 'modes.copy.label',
    descKey: 'modes.copy.desc',
    detailKey: 'modes.copy.detail',
  },
  {
    value: 'subscribe',
    labelKey: 'modes.subscribe.label',
    descKey: 'modes.subscribe.desc',
    detailKey: 'modes.subscribe.detail',
  },
  {
    value: 'snapshot',
    labelKey: 'modes.snapshot.label',
    descKey: 'modes.snapshot.desc',
    detailKey: 'modes.snapshot.detail',
  },
]

const STATUS_CONFIG: Record<string, { labelKey: string; bg: string; text: string }> = {
  pending: { labelKey: 'status.pending', ...statusColors.pending },
  active: { labelKey: 'status.active', ...statusColors.active },
  revoked: { labelKey: 'status.revoked', ...statusColors.revoked },
  declined: { labelKey: 'status.declined', ...statusColors.declined },
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
  const { t } = useTranslation('sharing')
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

    const link = `https://reeeeecallstudy.xyz/invite/${inviteCode}`
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
    Alert.alert(t('revokeAlert.title'), t('revokeAlert.message'), [
      { text: t('actions.cancel'), style: 'cancel' },
      {
        text: t('actions.revoke'),
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
      <ScreenHeader title={deck?.name ?? t('shareDeck.title')} mode="back" testID="share-back" />
      <View style={styles.content}>

        {/* Deck name */}
        <View style={styles.titleRow}>
          <Text style={styles.titleIcon}>{deck?.icon ?? '📚'}</Text>
          <Text style={[theme.typography.h2, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
            {deck?.name ?? t('shareDeck.title')}
          </Text>
        </View>

        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
          {t('shareDeck.subtitle')}
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
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('shareMode')}</Text>
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
                          {t(m.labelKey)}
                        </Text>
                        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                          {t(m.descKey)}
                        </Text>
                      </View>
                    </View>
                    {isSelected && (
                      <Text style={[theme.typography.caption, { color: palette.blue[600], marginTop: 6 }]}>
                        {t(m.detailKey)}
                      </Text>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>

            <Button
              testID="share-create-link"
              title={creating ? t('shareDeck.creating') : t('shareDeck.generateLink')}
              onPress={handleCreate}
              loading={creating}
            />
          </>
        ) : (
          <View style={[styles.linkCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('inviteLink')}</Text>
            <View style={[styles.linkBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                {inviteLink}
              </Text>
            </View>
            <View style={styles.linkActions}>
              <Button
                testID="share-copy-link"
                title={copied ? t('shareDeck.copied') : t('shareDeck.copyLink')}
                onPress={handleCopyLink}
                size="sm"
              />
              <Button
                testID="share-new-link"
                title={t('shareDeck.newLink')}
                variant="outline"
                size="sm"
                onPress={handleNewLink}
              />
            </View>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {t('shareDeck.linkHint')}
            </Text>
          </View>
        )}

        {/* Existing Shares */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            {t('shareDeck.existingShares', { count: shares.length })}
          </Text>

          {shares.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                {t('shareDeck.noShares')}
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
                      {share.invite_email || share.invite_code || t('inviteLink')}
                    </Text>
                    <View style={styles.shareMeta}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                        {t(`modes.${share.share_mode}.label`)}
                      </Text>
                      <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                        <Text style={[styles.statusText, { color: status.text }]}>
                          {t(status.labelKey)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {(share.status === 'pending' || share.status === 'active') && (
                    <TouchableOpacity
                      onPress={() => handleRevoke(share.id)}
                      style={styles.revokeBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      testID={`share-revoke-${share.id}`}
                    >
                      <Text style={[theme.typography.caption, { color: palette.red[500] }]}>{t('actions.revoke')}</Text>
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
  revokeBtn: { paddingHorizontal: 10, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
})
