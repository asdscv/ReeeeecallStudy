import { useState, useEffect } from 'react'
import { View, Text, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button } from '../components/ui'
import { useCards } from '../hooks/useCards'
import { useDecks } from '../hooks/useDecks'
import { useTheme } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'CardEdit'>
type Route = RouteProp<DecksStackParamList, 'CardEdit'>

export function CardEditScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const { deckId, cardId } = route.params

  const { decks, templates } = useDecks()
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
        await createCard({
          deck_id: deckId,
          template_id: template?.id ?? '',
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
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Button title="← Cancel" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />
        </View>

        <Text style={[theme.typography.h2, { color: theme.colors.text }]}>
          {isEditing ? 'Edit Card' : 'New Card'}
        </Text>

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
                await createCard({
                  deck_id: deckId,
                  template_id: template?.id ?? '',
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
  topRow: { flexDirection: 'row' },
})
