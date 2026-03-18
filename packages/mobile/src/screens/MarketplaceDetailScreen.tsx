import { useState, useEffect } from 'react'
import { View, Text, FlatList, Alert, StyleSheet, Linking } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { Screen, Button, Badge, ListCard } from '../components/ui'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import { useTheme } from '../theme'
import { getMobileSupabase } from '../adapters'
import type { MarketplaceStackParamList } from '../navigation/types'

const SUPPORT_EMAIL = 'support@reeeeecall.com'

type Route = RouteProp<MarketplaceStackParamList, 'MarketplaceDetail'>

export function MarketplaceDetailScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const route = useRoute<Route>()
  const { listingId } = route.params

  const { listings, acquireDeck } = useMarketplaceStore()
  const listing = listings.find((l) => l.id === listingId)

  const [previewCards, setPreviewCards] = useState<Array<{ id: string; field_values: Record<string, string> }>>([])
  const [acquiring, setAcquiring] = useState(false)

  // Fetch preview cards
  useEffect(() => {
    if (!listing) return
    const supabase = getMobileSupabase()
    supabase
      .from('cards')
      .select('id, field_values')
      .eq('deck_id', listing.deck_id)
      .limit(10)
      .then(({ data }) => {
        if (data) setPreviewCards(data)
      })
  }, [listing])

  if (!listing) {
    return (
      <Screen testID="marketplace-detail-screen">
        <View style={styles.center}>
          <Text style={[theme.typography.h3, { color: theme.colors.textSecondary }]}>Listing not found</Text>
          <Button title="Go Back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    )
  }

  const handleReport = () => {
    Alert.alert(
      'Report Content',
      'Why are you reporting this deck?',
      [
        {
          text: 'Inappropriate Content',
          onPress: () => {
            const subject = encodeURIComponent(`Report: Inappropriate Content — ${listing?.title ?? listingId}`)
            const body = encodeURIComponent(`Listing ID: ${listingId}\nReason: Inappropriate Content\n\nPlease describe the issue:\n`)
            Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`)
            Alert.alert('Thank you', 'Your report has been submitted. We will review this content promptly.')
          },
        },
        {
          text: 'Copyright Violation',
          onPress: () => {
            const subject = encodeURIComponent(`Report: Copyright Violation — ${listing?.title ?? listingId}`)
            const body = encodeURIComponent(`Listing ID: ${listingId}\nReason: Copyright Violation\n\nPlease describe the issue:\n`)
            Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`)
            Alert.alert('Thank you', 'Your report has been submitted. We will review this content promptly.')
          },
        },
        {
          text: 'Spam / Misleading',
          onPress: () => {
            const subject = encodeURIComponent(`Report: Spam — ${listing?.title ?? listingId}`)
            const body = encodeURIComponent(`Listing ID: ${listingId}\nReason: Spam / Misleading\n\nPlease describe the issue:\n`)
            Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`)
            Alert.alert('Thank you', 'Your report has been submitted. We will review this content promptly.')
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  const handleAcquire = async () => {
    setAcquiring(true)
    try {
      await acquireDeck(listingId)
      Alert.alert('Success', 'Deck added to your collection!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ])
    } catch (e) {
      Alert.alert('Error', 'Failed to download deck')
    } finally {
      setAcquiring(false)
    }
  }

  return (
    <Screen safeArea padding={false} testID="marketplace-detail-screen">
      <FlatList
        data={previewCards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Button title="← Back" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />

            <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{listing.title}</Text>

            {listing.description && (
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
                {listing.description}
              </Text>
            )}

            <View style={styles.metaRow}>
              <Badge label={`${listing.card_count ?? 0} cards`} variant="neutral" />
              <Badge label={`${listing.acquire_count ?? 0} downloads`} variant="primary" />
              {listing.share_mode && <Badge label={listing.share_mode} variant="success" />}
            </View>

            {listing.tags && listing.tags.length > 0 && (
              <View style={styles.tagRow}>
                {listing.tags.map((tag: string) => (
                  <Text key={tag} style={[theme.typography.caption, styles.tag, { color: theme.colors.textSecondary, backgroundColor: theme.colors.surface }]}>
                    #{tag}
                  </Text>
                ))}
              </View>
            )}

            <Button
              testID="marketplace-acquire-button"
              title={acquiring ? 'Downloading...' : 'Add to My Decks'}
              onPress={handleAcquire}
              loading={acquiring}
            />

            <Button
              testID="marketplace-report-button"
              title="Report Content"
              variant="ghost"
              size="sm"
              onPress={handleReport}
            />

            {previewCards.length > 0 && (
              <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 16 }]}>
                Preview Cards
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const values = Object.values(item.field_values)
          return (
            <ListCard testID={`preview-card-${item.id}`}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                {values[0] ?? ''}
              </Text>
              {values[1] && (
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                  {values[1]}
                </Text>
              )}
            </ListCard>
          )
        }}
        ListEmptyComponent={
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', padding: 20 }]}>
            No preview available
          </Text>
        }
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 8 },
  metaRow: { flexDirection: 'row', gap: 6 },
  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
})
