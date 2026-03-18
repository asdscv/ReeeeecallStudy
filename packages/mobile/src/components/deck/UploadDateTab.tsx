import { View, Text, SectionList, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'
import { ListCard, Badge } from '../ui'
import { groupCardsByDate } from '@reeeeecall/shared/lib/stats'
import { formatDateKeyShort } from '@reeeeecall/shared/lib/date-utils'
import type { Card } from '@reeeeecall/shared/types/database'

interface UploadDateTabProps {
  cards: Card[]
  onCardPress: (cardId: string) => void
  testID?: string
}

interface DateSection {
  title: string
  date: string
  count: number
  data: Card[]
}

export function UploadDateTab({ cards, onCardPress, testID }: UploadDateTabProps) {
  const theme = useTheme()

  const grouped = groupCardsByDate(cards)

  const sections: DateSection[] = grouped.map((g) => {
    const sectionCards = cards.filter((c) => {
      const key = c.created_at.slice(0, 10) // YYYY-MM-DD
      return key === g.date
    })
    return {
      title: formatDateKeyShort(g.date),
      date: g.date,
      count: g.count,
      data: sectionCards,
    }
  })

  if (sections.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>No cards yet</Text>
      </View>
    )
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      testID={testID}
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <View style={[styles.sectionHeader, { borderBottomColor: theme.colors.border }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{section.title}</Text>
          <Badge label={`${section.count} cards`} variant="neutral" />
        </View>
      )}
      renderItem={({ item }) => {
        const front = Object.values(item.field_values)[0] ?? ''
        return (
          <ListCard onPress={() => onCardPress(item.id)} testID={`upload-card-${item.id}`}>
            <View style={styles.cardRow}>
              <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]} numberOfLines={1}>
                {front || '(empty)'}
              </Text>
              <Badge
                label={item.srs_status}
                variant={
                  item.srs_status === 'new' ? 'primary' :
                  item.srs_status === 'review' ? 'success' :
                  item.srs_status === 'learning' ? 'warning' : 'neutral'
                }
              />
            </View>
          </ListCard>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  list: { gap: 6 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  empty: { padding: 40, alignItems: 'center' },
})
