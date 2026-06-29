import { useState } from 'react'
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { useDecks } from '../hooks'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import { LEARNING_LANGUAGES } from '@reeeeecall/shared/lib/marketplace'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Route = RouteProp<DecksStackParamList, 'PublishDeck'>

const CATEGORIES = [
  'general', 'language', 'science', 'math', 'history', 'programming', 'trivia', 'exam', 'other',
]

const SHARE_MODES = [
  { value: 'copy', labelKey: 'modes.copy.label', descriptionKey: 'modes.copy.desc' },
  { value: 'subscribe', labelKey: 'modes.subscribe.label', descriptionKey: 'modes.subscribe.desc' },
  { value: 'snapshot', labelKey: 'modes.snapshot.label', descriptionKey: 'modes.snapshot.desc' },
] as const

export function PublishDeckScreen() {
  const theme = useTheme()
  const { t } = useTranslation('marketplace')
  const { t: ts } = useTranslation('sharing')
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
  const [learningLanguage, setLearningLanguage] = useState<string | undefined>(deck?.learning_language ?? undefined)
  const [shareMode, setShareMode] = useState<'copy' | 'subscribe' | 'snapshot'>('copy')
  const [publishing, setPublishing] = useState(false)

  const handlePublish = async () => {
    if (!title.trim()) {
      Alert.alert(ts('publish.errorTitle'), ts('publish.titleRequired'))
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
        learningLanguage,
        shareMode,
      })
      Alert.alert(ts('publish.publishedTitle'), ts('publish.publishedMessage'), [
        { text: ts('publish.ok'), onPress: () => navigation.goBack() },
      ])
    } catch {
      Alert.alert(ts('publish.errorTitle'), ts('publish.publishFailed'))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Screen scroll keyboard testID="publish-deck-screen">
      <ScreenHeader title={t('publish.title')} mode="back" />
      <View style={styles.content}>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
          {ts('publish.subtitle')}
        </Text>

        <TextInput testID="publish-title" label={ts('publish.titleLabel')} value={title} onChangeText={setTitle} placeholder={ts('publish.titlePlaceholder')} />
        <TextInput testID="publish-description" label={ts('publish.descriptionLabel')} value={description} onChangeText={setDescription} placeholder={ts('publish.descriptionPlaceholder')} multiline numberOfLines={3} />
        <TextInput testID="publish-tags" label={ts('publish.tagsLabel')} value={tags} onChangeText={setTags} placeholder={ts('publish.tagsPlaceholder')} hint={ts('publish.tagsHint')} />

        {/* Category */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{ts('publish.category')}</Text>
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

        {/* Learning Language */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('learningLanguage.label')}</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              testID="publish-lang-all"
              onPress={() => setLearningLanguage(undefined)}
              style={[styles.chip, {
                backgroundColor: !learningLanguage ? theme.colors.primaryLight : theme.colors.surface,
                borderColor: !learningLanguage ? theme.colors.primary : theme.colors.border,
              }]}
            >
              <Text style={[theme.typography.bodySmall, { color: !learningLanguage ? theme.colors.primary : theme.colors.text }]}>
                {t('learningLanguage.all')}
              </Text>
            </TouchableOpacity>
            {LEARNING_LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.value}
                testID={`publish-lang-${lang.value}`}
                onPress={() => setLearningLanguage(lang.value)}
                style={[styles.chip, {
                  backgroundColor: learningLanguage === lang.value ? theme.colors.primaryLight : theme.colors.surface,
                  borderColor: learningLanguage === lang.value ? theme.colors.primary : theme.colors.border,
                }]}
              >
                <Text style={[theme.typography.bodySmall, { color: learningLanguage === lang.value ? theme.colors.primary : theme.colors.text }]}>
                  {t(lang.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Share Mode */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{ts('shareMode')}</Text>
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
                {ts(mode.labelKey)}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {ts(mode.descriptionKey)}
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
