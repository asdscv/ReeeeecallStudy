import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useCardStore } from '@reeeeecall/shared/stores/card-store'
import { presetIdForTemplate, fieldLabelId } from '@reeeeecall/shared/lib/default-templates'
import type { CardTemplate, TemplateField } from '@reeeeecall/shared/types/database'
import { getMobileSupabase } from '../adapters'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'QuickCreate'>

const INITIAL_ROWS = 3

/**
 * Mobile mirror of web's QuickCreateModal — a dead-simple "just add stuff" flow:
 * name the deck, pick one of the built-in default templates (simplest =
 * Front/Back), type a few cards, done. The full DeckEdit + CardEdit flow is
 * untouched; this sits alongside it for users who find the advanced path heavy.
 */
export function QuickCreateScreen() {
  const theme = useTheme()
  const { t } = useTranslation(['decks', 'common'])
  const navigation = useNavigation<Nav>()

  // Templates come from the shared deck store (via the mobile hook so they fetch
  // on focus); mutations + ensureDefaultTemplates are called on the store directly.
  const { templates } = useDecks()
  const { ensureDefaultTemplates, createDeck } = useDeckStore()
  const { createCards } = useCardStore()

  const [deckName, setDeckName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [rows, setRows] = useState<Record<string, string>[]>(
    Array.from({ length: INITIAL_ROWS }, () => ({})),
  )
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // If deck creation succeeded but card insert failed, we keep the screen open
  // and remember the deck id so a retry only re-runs createCards — never a
  // second createDeck (which would create a duplicate deck).
  const [createdDeckId, setCreatedDeckId] = useState<string | null>(null)
  // Current user id — used to scope the default-template picker to the user's OWN
  // templates. card_templates RLS also returns a subscribed publisher's
  // is_default templates; adopting one as this deck's default breaks if the
  // share is later revoked, so we filter those out.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  useEffect(() => {
    getMobileSupabase().auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
  }, [])

  // On mount: make sure the user actually has default templates to pick from
  // (self-heals zero-template accounts via the ensure_default_templates RPC).
  useEffect(() => {
    let active = true
    setPreparing(true)
    setCreatedDeckId(null)
    ensureDefaultTemplates().finally(() => {
      if (active) setPreparing(false)
    })
    return () => {
      active = false
    }
  }, [ensureDefaultTemplates])

  // Default-select the simplest preset once templates are loaded.
  useEffect(() => {
    if (templateId) return
    const first = templates.find((tpl) => tpl.is_default && tpl.user_id === currentUserId)
    if (first) setTemplateId(first.id)
  }, [templates, templateId, currentUserId])

  const defaultTemplates = templates.filter((tpl) => tpl.is_default && tpl.user_id === currentUserId)
  const selectedTemplate: CardTemplate | undefined = templates.find((tpl) => tpl.id === templateId)
  const textFields: TemplateField[] = (selectedTemplate?.fields ?? []).filter((f) => f.type === 'text')

  const presetLabel = (tpl: CardTemplate) => {
    const id = presetIdForTemplate(tpl.name)
    return id ? t(`decks:quickCreate.presets.${id}`, { defaultValue: tpl.name }) : tpl.name
  }
  const fieldLabel = (f: TemplateField) => {
    const id = fieldLabelId(f.name)
    return id ? t(`decks:quickCreate.fields.${id}`, { defaultValue: f.name }) : f.name
  }
  const fieldPreview = (tpl: CardTemplate) =>
    (tpl.fields ?? [])
      .filter((f) => f.type === 'text')
      .map((f) => fieldLabel(f))
      .join(' · ')

  const setCell = (rowIdx: number, key: string, value: string) =>
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)))
  const addRow = () => setRows((prev) => [...prev, {}])
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx))

  const handleSubmit = async () => {
    if (loading) return // guard against double-submit creating a duplicate deck
    setError(null)

    const name = deckName.trim()
    if (!name) {
      setError(t('decks:quickCreate.errors.nameRequired'))
      return
    }
    if (!selectedTemplate) {
      setError(t('decks:quickCreate.errors.templateRequired'))
      return
    }

    // Keep only rows with at least one non-empty text field.
    const cards = rows
      .map((row) => {
        const fv: Record<string, string> = {}
        for (const f of textFields) {
          const v = (row[f.key] ?? '').trim()
          if (v) fv[f.key] = v
        }
        return fv
      })
      .filter((fv) => Object.keys(fv).length > 0)
      .map((fv) => ({ field_values: fv }))

    if (cards.length === 0) {
      setError(t('decks:quickCreate.errors.cardsRequired'))
      return
    }

    setLoading(true)

    // Create the deck only once; a retry after a card failure reuses it.
    let deckId = createdDeckId
    if (!deckId) {
      const deck = await createDeck({ name, default_template_id: selectedTemplate.id })
      if (!deck) {
        setError(useDeckStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
        setLoading(false)
        return
      }
      deckId = deck.id
      setCreatedDeckId(deck.id)
    }

    const inserted = await createCards({
      deck_id: deckId,
      template_id: selectedTemplate.id,
      cards,
    })
    setLoading(false)

    // Cards failed: keep the screen open with the error so the user doesn't lose
    // what they typed. The deck already exists (createdDeckId retained), so
    // resubmitting retries only the card insert — no duplicate deck.
    if (inserted < cards.length) {
      setError(useCardStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
      return
    }

    // Replace this screen with the new deck so Back goes to the deck list.
    navigation.replace('DeckDetail', { deckId })
  }

  return (
    <Screen scroll keyboard testID="quick-create-screen">
      <ScreenHeader title={t('decks:quickCreate.title')} mode="back" />
      <View style={styles.content}>
        {error && (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.errorLight }]}>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.error }]}>
              {t(error, { defaultValue: error })}
            </Text>
          </View>
        )}

        {/* Deck name */}
        <TextInput
          testID="quick-create-name"
          label={t('decks:quickCreate.deckName')}
          placeholder={t('decks:quickCreate.deckNamePlaceholder')}
          value={deckName}
          onChangeText={setDeckName}
          autoFocus
        />

        {/* Template preset picker */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            {t('decks:quickCreate.template')}
          </Text>
          {preparing && defaultTemplates.length === 0 ? (
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
              {t('common:loading', { defaultValue: 'Loading...' })}
            </Text>
          ) : (
            <View style={styles.presetGrid}>
              {defaultTemplates.map((tpl) => {
                const selected = tpl.id === templateId
                return (
                  <TouchableOpacity
                    key={tpl.id}
                    onPress={() => setTemplateId(tpl.id)}
                    activeOpacity={0.7}
                    style={[
                      styles.presetCard,
                      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                      selected && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
                    ]}
                    testID={`quick-create-preset-${tpl.id}`}
                  >
                    <Text
                      style={[
                        theme.typography.label,
                        { color: selected ? theme.colors.primary : theme.colors.text },
                      ]}
                      numberOfLines={1}
                    >
                      {presetLabel(tpl)}
                    </Text>
                    <Text
                      style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {fieldPreview(tpl)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
        </View>

        {/* Card entry rows */}
        {textFields.length > 0 && (
          <View style={styles.section}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>
              {t('decks:quickCreate.cards')}
            </Text>
            {rows.map((row, idx) => (
              <View
                key={idx}
                style={[styles.rowCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
              >
                <View style={styles.rowFields}>
                  {textFields.map((f) => (
                    <TextInput
                      key={f.key}
                      testID={`quick-create-row-${idx}-${f.key}`}
                      placeholder={fieldLabel(f)}
                      value={row[f.key] ?? ''}
                      onChangeText={(v) => setCell(idx, f.key, v)}
                    />
                  ))}
                </View>
                {rows.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeRow(idx)}
                    style={styles.removeBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={t('decks:quickCreate.removeRow')}
                    testID={`quick-create-row-${idx}-remove`}
                  >
                    <Text style={[styles.removeIcon, { color: theme.colors.textTertiary }]}>{'×'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity onPress={addRow} style={styles.addRowBtn} testID="quick-create-add-row">
              <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
                {t('decks:quickCreate.addRow')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <Button
          testID="quick-create-submit"
          title={loading ? t('decks:quickCreate.creating') : t('decks:quickCreate.create')}
          onPress={handleSubmit}
          loading={loading}
          disabled={loading || preparing || !deckName.trim()}
        />
        <Button
          testID="quick-create-cancel"
          title={t('decks:quickCreate.cancel')}
          variant="outline"
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },
  errorBox: { padding: 12, borderRadius: 10 },
  section: { gap: 8 },
  presetGrid: { gap: 8 },
  presetCard: { padding: 12, borderRadius: 10, borderWidth: 1.5, gap: 2 },
  rowCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  rowFields: { flex: 1, gap: 8 },
  removeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  removeIcon: { fontSize: 22, lineHeight: 24 },
  addRowBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
})
