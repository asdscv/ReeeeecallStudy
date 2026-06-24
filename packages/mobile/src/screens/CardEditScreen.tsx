import { useState, useEffect } from 'react'
import { View, Text, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { useCards } from '../hooks/useCards'
import { useDecks } from '../hooks/useDecks'
import { useTheme } from '../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'CardEdit'>
type Route = RouteProp<DecksStackParamList, 'CardEdit'>

export function CardEditScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const { deckId, cardId } = route.params

  const { decks, templates, updateDeck } = useDecks()
  const { ensureDefaultTemplates } = useDeckStore()
  const { cards, createCard, updateCard } = useCards(deckId)

  const deck = decks.find((d) => d.id === deckId)
  const card = cardId ? cards.find((c) => c.id === cardId) : null
  const isEditing = !!card

  const template = templates.find((t) => t.id === (card?.template_id ?? deck?.default_template_id))
  const fields = template?.fields ?? []

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(
    card?.field_values ?? {},
  )
  const [tags, setTags] = useState(card?.tags?.join(', ') ?? '')
  const [saving, setSaving] = useState(false)

  // Reset form when card changes
  useEffect(() => {
    if (card) {
      setFieldValues(card.field_values)
      setTags(card.tags?.join(', ') ?? '')
    }
  }, [card])

  const setField = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }

  const hasContent = Object.values(fieldValues).some((v) => v.trim())

  /**
   * Resolve a non-empty template id for new cards.
   *
   * cards.template_id is NOT NULL, so submitting '' (which happened when a deck
   * had no default template — e.g. pre-036 signup bug, or a deck created with
   * default_template_id null) FK-violated and dead-ended card creation. Guard it:
   * if no template resolves, self-heal the account's default templates, adopt the
   * first one, and persist it as this deck's default so it sticks for next time.
   */
  const resolveTemplateId = async (): Promise<string | null> => {
    if (template?.id) return template.id
    // No template on the card/deck — seed defaults and pick the first one.
    await ensureDefaultTemplates()
    const seeded = useDeckStore.getState().templates
    const fallback = seeded.find((t) => t.is_default) ?? seeded[0]
    if (!fallback) return null
    // Persist on the deck so future cards resolve a template without re-healing.
    if (deck && !deck.default_template_id) {
      await updateDeck(deckId, { default_template_id: fallback.id })
    }
    return fallback.id
  }

  const handleSave = async () => {
    if (!hasContent) {
      Alert.alert('Error', 'At least one field must have content')
      return
    }

    setSaving(true)
    try {
      const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean)

      if (isEditing && cardId) {
        await updateCard(cardId, {
          field_values: fieldValues,
          tags: parsedTags,
        })
      } else {
        const resolvedTemplateId = await resolveTemplateId()
        if (!resolvedTemplateId) {
          Alert.alert('Error', 'No card template available')
          return
        }
        await createCard({
          deck_id: deckId,
          template_id: resolvedTemplateId,
          field_values: fieldValues,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        })
      }
      navigation.goBack()
    } catch (e) {
      Alert.alert('Error', 'Failed to save card')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen scroll keyboard testID="card-edit-screen">
      <ScreenHeader title={isEditing ? 'Edit Card' : 'New Card'} mode="back" />
      <View style={styles.content}>

        {template && (
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            Template: {template.name}
          </Text>
        )}

        {/* Dynamic fields from template */}
        {fields.length > 0 ? (
          fields
            .sort((a, b) => a.order - b.order)
            .map((field) => (
              <TextInput
                key={field.key}
                testID={`card-edit-field-${field.key}`}
                label={field.name}
                placeholder={field.detail || `Enter ${field.name.toLowerCase()}`}
                value={fieldValues[field.key] ?? ''}
                onChangeText={(v) => setField(field.key, v)}
                multiline={field.type === 'text'}
                numberOfLines={field.type === 'text' ? 3 : 1}
              />
            ))
        ) : (
          // Fallback: basic front/back
          <>
            <TextInput
              testID="card-edit-field-front"
              label="Front"
              placeholder="Question or term"
              value={fieldValues.front ?? ''}
              onChangeText={(v) => setField('front', v)}
              multiline
              numberOfLines={3}
            />
            <TextInput
              testID="card-edit-field-back"
              label="Back"
              placeholder="Answer or definition"
              value={fieldValues.back ?? ''}
              onChangeText={(v) => setField('back', v)}
              multiline
              numberOfLines={3}
            />
          </>
        )}

        {/* Tags */}
        <TextInput
          testID="card-edit-tags"
          label="Tags"
          placeholder="comma, separated, tags"
          value={tags}
          onChangeText={setTags}
          hint="Separate tags with commas"
        />

        <Button
          testID="card-edit-save"
          title={isEditing ? 'Save Changes' : 'Add Card'}
          onPress={handleSave}
          loading={saving}
          disabled={!hasContent}
        />

        {/* Add another button (create mode only) */}
        {!isEditing && (
          <Button
            testID="card-edit-save-another"
            title="Add & Create Another"
            variant="outline"
            onPress={async () => {
              if (!hasContent) return
              setSaving(true)
              try {
                const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean)
                const resolvedTemplateId = await resolveTemplateId()
                if (!resolvedTemplateId) {
                  Alert.alert('Error', 'No card template available')
                  return
                }
                await createCard({
                  deck_id: deckId,
                  template_id: resolvedTemplateId,
                  field_values: fieldValues,
                  tags: parsedTags.length > 0 ? parsedTags : undefined,
                })
                // Reset form
                setFieldValues({})
                setTags('')
              } catch {
                Alert.alert('Error', 'Failed to save card')
              } finally {
                setSaving(false)
              }
            }}
            loading={saving}
            disabled={!hasContent}
          />
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },

})
