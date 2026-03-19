import { useState } from 'react'
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { Screen, TextInput, Button } from '../components/ui'
import { useDecks } from '../hooks'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Route = RouteProp<DecksStackParamList, 'PublishDeck'>

const CATEGORIES = [
  'general', 'language', 'science', 'math', 'history', 'programming', 'trivia', 'exam', 'other',
]

const SHARE_MODES = [
  { value: 'copy', label: 'Copy', description: 'Users get an editable copy' },
  { value: 'subscribe', label: 'Subscribe', description: 'Users get read-only, auto-updated' },
  { value: 'snapshot', label: 'Snapshot', description: 'Users get read-only copy, no updates' },
] as const

export function PublishDeckScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const route = useRoute<Route>()
  const { deckId } = route.params

  const { decks } = useDecks()
  const { publishDeck } = useMarketplaceStore()
  const deck = decks.find((d) => d.id === deckId)

  const [title, setTitle] = useState(deck?.name ?? '')
  const [description, setDescription] = useState(deck?.description ?? '')
  const [tags, setTags] = useState('')
  const [category, setCategory] = useState('general')
  const [shareMode, setShareMode] = useState<'copy' | 'subscribe' | 'snapshot'>('copy')
  const [publishing, setPublishing] = useState(false)

  const handlePublish = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title is required')
      return
    }

    setPublishing(true)
    try {
      const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean)
      await publishDeck({
        deckId,
        title: title.trim(),
        description: description.trim() || undefined,
        tags: parsedTags,
        category,
        shareMode,
      })
      Alert.alert('Published!', 'Your deck is now available on the marketplace.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ])
    } catch {
      Alert.alert('Error', 'Failed to publish deck')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Screen scroll keyboard testID="publish-deck-screen">
      <View style={styles.content}>
        <Button title="← Back" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />

        <Text style={[theme.typography.h1, { color: theme.colors.text }]}>{t('publish.title')}</Text>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
          Share your deck with the community
        </Text>

        <TextInput testID="publish-title" label="Title" value={title} onChangeText={setTitle} placeholder="Deck title on marketplace" />
        <TextInput testID="publish-description" label="Description" value={description} onChangeText={setDescription} placeholder="What will learners study?" multiline numberOfLines={3} />
        <TextInput testID="publish-tags" label="Tags" value={tags} onChangeText={setTags} placeholder="comma, separated, tags" hint="Help others find your deck" />

        {/* Category */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                testID={`publish-cat-${cat}`}
                onPress={() => setCategory(cat)}
                style={[styles.chip, {
                  backgroundColor: category === cat ? theme.colors.primaryLight : theme.colors.surface,
                  borderColor: category === cat ? theme.colors.primary : theme.colors.border,
                }]}
              >
                <Text style={[theme.typography.bodySmall, { color: category === cat ? theme.colors.primary : theme.colors.text, textTransform: 'capitalize' }]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Share Mode */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Share Mode</Text>
          {SHARE_MODES.map((mode) => (
            <TouchableOpacity
              key={mode.value}
              testID={`publish-mode-${mode.value}`}
              onPress={() => setShareMode(mode.value)}
              style={[styles.modeCard, {
                backgroundColor: shareMode === mode.value ? theme.colors.primaryLight : theme.colors.surface,
                borderColor: shareMode === mode.value ? theme.colors.primary : theme.colors.border,
              }]}
            >
              <Text style={[theme.typography.label, { color: shareMode === mode.value ? theme.colors.primary : theme.colors.text }]}>
                {mode.label}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {mode.description}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Button testID="publish-submit" title={t('publish.publishButton')} onPress={handlePublish} loading={publishing} disabled={!title.trim()} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },
  section: { gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 },
  modeCard: { padding: 14, borderRadius: 12, borderWidth: 1.5, gap: 4 },
})
