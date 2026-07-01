import { useState, useEffect } from 'react'
import { View, Text, Alert, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { useCards } from '../hooks/useCards'
import { useDecks } from '../hooks/useDecks'
import { useTheme } from '../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import type { CardTemplate } from '@reeeeecall/shared/types/database'
import { getMobileSupabase } from '../adapters'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'CardEdit'>
type Route = RouteProp<DecksStackParamList, 'CardEdit'>

export function CardEditScreen() {
  const theme = useTheme()
  const { t } = useTranslation('decks')
  const { t: tLimit } = useTranslation(['errors', 'settings'])
  const navigation = useNavigation<Nav>()
  const limit = useCardLimit()
  const route = useRoute<Route>()
  const { deckId, cardId } = route.params

  const { decks, templates, updateDeck } = useDecks()
  const { ensureDefaultTemplates } = useDeckStore()
  const { cards, createCard, updateCard } = useCards(deckId)

  const deck = decks.find((d) => d.id === deckId)
  const card = cardId ? cards.find((c) => c.id === cardId) : null
  const isEditing = !!card

  // Template resolved from the loaded list (card's own, then deck's default).
  const listTemplate = templates.find((t) => t.id === (card?.template_id ?? deck?.default_template_id))
  // A template adopted up-front when the deck has none (heal-before-render). This
  // ensures the entry form renders the REAL field keys (field_1/field_2/…) the
  // values get persisted under — otherwise a positional front/back fallback form
  // would write to keys that don't match the adopted template, and the card would
  // re-open blank.
  const [healedTemplate, setHealedTemplate] = useState<CardTemplate | null>(null)
  const template = listTemplate ?? healedTemplate
  const fields = template?.fields ?? []

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(
    card?.field_values ?? {},
  )
  const [tags, setTags] = useState(card?.tags?.join(', ') ?? '')
  const [saving, setSaving] = useState(false)

  // Current user id — used to scope the default-template fallback to the user's
  // OWN templates. card_templates RLS also returns a subscribed publisher's
  // is_default templates; adopting one as this deck's default breaks if the
  // share is later revoked, so we never fall back to a non-owned template.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  useEffect(() => {
    getMobileSupabase().auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
  }, [])

  // Reset form when card changes
  useEffect(() => {
    if (card) {
      setFieldValues(card.field_values)
      setTags(card.tags?.join(', ') ?? '')
    }
  }, [card])

  // Heal-before-render: in create mode, if the deck has no resolvable template,
  // seed defaults + adopt the first default + persist it on the deck up front,
  // then set it into state so the form renders the real template fields (and the
  // user types into the correct field keys). Save-time resolveTemplateId() stays
  // as a fallback but is no longer the primary path.
  useEffect(() => {
    if (isEditing) return // editing an existing card always has its own template
    if (listTemplate || healedTemplate) return // already resolved
    let active = true
    ;(async () => {
      await ensureDefaultTemplates()
      const seeded = useDeckStore.getState().templates
      // Scope the fallback to the user's OWN templates: a subscribed publisher's
      // is_default template (also visible via RLS) must never become this deck's
      // default — it vanishes if the share is revoked.
      const fallback =
        seeded.find((t) => t.is_default && t.user_id === currentUserId) ??
        seeded.find((t) => t.user_id === currentUserId)
      if (!fallback || !active) return
      // Persist on the deck so future cards resolve a template without re-healing.
      if (deck && !deck.default_template_id) {
        await updateDeck(deckId, { default_template_id: fallback.id })
      }
      if (active) setHealedTemplate(fallback)
    })()
    return () => {
      active = false
    }
    // deckId keys the heal; deck/listTemplate update as the stores load.
  }, [isEditing, listTemplate, healedTemplate, deck, deckId, ensureDefaultTemplates, updateDeck, currentUserId])

  const setField = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }

  const hasContent = Object.values(fieldValues).some((v) => v.trim())

  /**
   * Resolve a non-empty template id for new cards (save-time fallback).
   *
   * The mount-time heal effect normally resolves the template before render, so
   * this is a backstop for the rare case it hasn't completed yet. cards.template_id
   * is NOT NULL, so submitting '' (which happened when a deck had no default
   * template — e.g. pre-036 signup bug, or a deck created with default_template_id
   * null) FK-violated and dead-ended card creation. Guard it: if no template
   * resolves, self-heal the account's default templates, adopt the first one, and
   * persist it as this deck's default so it sticks for next time.
   */
  const resolveTemplateId = async (): Promise<string | null> => {
    if (template?.id) return template.id
    // No template on the card/deck — seed defaults and pick the first one.
    await ensureDefaultTemplates()
    const seeded = useDeckStore.getState().templates
    // Scope the fallback to the user's OWN templates (see heal effect above): a
    // subscribed publisher's is_default template must never become this deck's
    // default — it would FK-dangle if the share is later revoked.
    const fallback =
      seeded.find((t) => t.is_default && t.user_id === currentUserId) ??
      seeded.find((t) => t.user_id === currentUserId)
    if (!fallback) return null
    // Persist on the deck so future cards resolve a template without re-healing.
    if (deck && !deck.default_template_id) {
      await updateDeck(deckId, { default_template_id: fallback.id })
    }
    return fallback.id
  }

  const handleSave = async () => {
    if (!hasContent) {
      Alert.alert(t('cardEdit.errorTitle'), t('cardEdit.emptyError'))
      return
    }

    // Owned-card limit pre-flight (mig 116) — only for NEW cards. Server also enforces.
    if (!isEditing && limit.reached) {
      Alert.alert(tLimit('errors:card.limitReached'), tLimit('settings:cardUsage.reached'))
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
          Alert.alert(t('cardEdit.errorTitle'), t('cardEdit.noTemplateError'))
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
      Alert.alert(t('cardEdit.errorTitle'), t('cardEdit.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen scroll keyboard testID="card-edit-screen">
      <ScreenHeader title={isEditing ? t('cardEdit.editTitle') : t('cardEdit.newTitle')} mode="back" />
      <View style={styles.content}>

        {template && (
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            {t('cardEdit.templateLabel', { name: template.name })}
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
                placeholder={field.detail || t('cardEdit.enterField', { field: field.name })}
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
              label={t('cardEdit.front')}
              placeholder={t('cardEdit.frontPlaceholder')}
              value={fieldValues.front ?? ''}
              onChangeText={(v) => setField('front', v)}
              multiline
              numberOfLines={3}
            />
            <TextInput
              testID="card-edit-field-back"
              label={t('cardEdit.back')}
              placeholder={t('cardEdit.backPlaceholder')}
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
          label={t('cardEdit.tags')}
          placeholder={t('cardEdit.tagsPlaceholder')}
          value={tags}
          onChangeText={setTags}
          hint={t('cardEdit.tagsHint')}
        />

        <Button
          testID="card-edit-save"
          title={isEditing ? t('cardEdit.save') : t('cardEdit.add')}
          onPress={handleSave}
          loading={saving}
          disabled={!hasContent}
        />

        {/* Add another button (create mode only) */}
        {!isEditing && (
          <Button
            testID="card-edit-save-another"
            title={t('cardEdit.addAnother')}
            variant="outline"
            onPress={async () => {
              if (!hasContent) return
              setSaving(true)
              try {
                const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean)
                const resolvedTemplateId = await resolveTemplateId()
                if (!resolvedTemplateId) {
                  Alert.alert(t('cardEdit.errorTitle'), t('cardEdit.noTemplateError'))
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
                Alert.alert(t('cardEdit.errorTitle'), t('cardEdit.saveError'))
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
