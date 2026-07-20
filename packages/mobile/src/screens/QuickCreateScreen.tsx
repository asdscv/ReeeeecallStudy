import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useCardStore } from '@reeeeecall/shared/stores/card-store'
import { useTemplateStore } from '@reeeeecall/shared/stores/template-store'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import { CardLimitNotice } from '../components/CardLimitNotice'
import {
  QUICK_PRESETS,
  presetFieldSpecs,
  type QuickPreset,
  type QuickFieldSpec,
} from '@reeeeecall/shared/lib/default-templates'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'QuickCreate'>

const INITIAL_ROWS = 1

/**
 * Mobile mirror of web's QuickCreateModal — a dead-simple "just add stuff" flow:
 * name the deck (optional description), pick a card shape by FIELD COUNT
 * (front/back — simplest = 1 front / 1 back), type a few cards, done. The
 * matching card_template is found-or-created on submit, so the user never deals
 * with templates. The full DeckEdit + CardEdit flow is untouched.
 */
export function QuickCreateScreen() {
  const theme = useTheme()
  const { t } = useTranslation(['decks', 'common'])
  const { t: tLimit } = useTranslation(['errors', 'settings'])
  const navigation = useNavigation<Nav>()

  const { createDeck, deleteDeck } = useDeckStore()
  const { createCards } = useCardStore()
  const limit = useCardLimit()
  const { findOrCreatePresetTemplate } = useTemplateStore()

  const [deckName, setDeckName] = useState('')
  const [deckDescription, setDeckDescription] = useState('')
  const [presetId, setPresetId] = useState(QUICK_PRESETS[0].id)
  const [rows, setRows] = useState<Record<string, string>[]>(
    Array.from({ length: INITIAL_ROWS }, () => ({})),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // If deck/template creation succeeded but a later step failed, keep the screen
  // open and remember the ids so a retry never re-creates them (no duplicates).
  const [createdDeckId, setCreatedDeckId] = useState<string | null>(null)
  const [createdTemplateId, setCreatedTemplateId] = useState<string | null>(null)
  // How many of the current cards already landed — a retry after a partial insert
  // only sends the remainder (no duplicate cards).
  const [createdCardCount, setCreatedCardCount] = useState(0)
  // Synchronous in-flight guard (`loading` state commits asynchronously, so a
  // fast double-tap could enter handleSubmit twice and create two decks).
  const submitting = useRef(false)
  // Set synchronously right before a successful navigation.replace. react-navigation
  // fires `beforeRemove` synchronously during replace — before React commits the queued
  // setCreatedCardCount — so the listener's closure still sees createdCardCount===0 and
  // would delete the deck we just filled. This ref lets cleanupOrphanDeck bail on success.
  const succeeded = useRef(false)

  useEffect(() => {
    setCreatedDeckId(null)
    setCreatedTemplateId(null)
    setCreatedCardCount(0)
  }, [])

  const preset: QuickPreset = QUICK_PRESETS.find((p) => p.id === presetId) ?? QUICK_PRESETS[0]
  const specs: QuickFieldSpec[] = presetFieldSpecs(preset)

  const presetSummary = (p: QuickPreset) =>
    t('decks:quickCreate.presetSummary', { front: p.front, back: p.back })
  const fieldLabel = (spec: QuickFieldSpec) => {
    if (spec.side === 'front') {
      return spec.index === 1
        ? t('decks:quickCreate.fields.front')
        : t('decks:quickCreate.fields.frontN', { n: spec.index })
    }
    return spec.index === 1
      ? t('decks:quickCreate.fields.back')
      : t('decks:quickCreate.fields.backN', { n: spec.index })
  }

  const emptyRows = () => Array.from({ length: INITIAL_ROWS }, () => ({}))
  const cleanupOrphanDeck = () => {
    // Deck is created before its cards; if creation succeeded but no card ever
    // landed (createdCardCount === 0), abandoning the flow (cancel / preset
    // switch) would leave an empty orphan deck. Delete it; decks with cards stay.
    if (succeeded.current) return
    if (createdDeckId && createdCardCount === 0) void deleteDeck(createdDeckId)
  }
  // The Cancel button calls cleanupOrphanDeck, but the header back arrow AND the
  // Android hardware back button pop the screen without it — clean up on any leave.
  // (no-op when the deck has cards, so a successful create is never deleted.)
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => { cleanupOrphanDeck() })
    return unsub
  }, [navigation, createdDeckId, createdCardCount])
  const handleCancel = () => {
    cleanupOrphanDeck()
    navigation.goBack()
  }
  const selectPreset = (id: string) => {
    // Clear rows (field keys are reused with different meaning), drop any empty
    // deck created under the old shape, and reset the created ids so the new
    // shape is consistent end-to-end.
    cleanupOrphanDeck()
    setPresetId(id)
    setRows(emptyRows())
    setCreatedTemplateId(null)
    setCreatedDeckId(null)
    setCreatedCardCount(0)
  }
  const setCell = (rowIdx: number, key: string, value: string) =>
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)))
  const addRow = () => setRows((prev) => [...prev, {}])
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx))

  const handleSubmit = async () => {
    if (loading || submitting.current) return
    submitting.current = true
    try {
      setError(null)

      const name = deckName.trim()
      if (!name) {
        setError(t('decks:quickCreate.errors.nameRequired'))
        return
      }

      // Build cards. A non-empty row missing its front field blocks submit (an
      // empty front = a blank study prompt) instead of creating a broken card.
      const frontKeys = specs.filter((s) => s.side === 'front').map((s) => s.key)
      let incompleteFront = false
      const cards: { field_values: Record<string, string> }[] = []
      for (const row of rows) {
        const fv: Record<string, string> = {}
        for (const spec of specs) {
          const v = (row[spec.key] ?? '').trim()
          if (v) fv[spec.key] = v
        }
        if (Object.keys(fv).length === 0) continue
        if (frontKeys.some((k) => !fv[k])) { incompleteFront = true; continue }
        cards.push({ field_values: fv })
      }

      if (incompleteFront) {
        setError(t('decks:quickCreate.errors.frontRequired'))
        return
      }
      if (cards.length === 0) {
        setError(t('decks:quickCreate.errors.cardsRequired'))
        return
      }

      // Owned-card limit pre-flight (mig 116). Server also enforces at createCards.
      if (limit.exceeds(cards.length)) {
        setError(tLimit('errors:card.limitReached'))
        return
      }

      setLoading(true)

      // 1. find-or-create the template for this field shape (reused on retry).
      let templateId = createdTemplateId
      if (!templateId) {
        const tpl = await findOrCreatePresetTemplate(preset)
        if (!tpl) {
          setError(useTemplateStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
          return
        }
        templateId = tpl.id
        setCreatedTemplateId(tpl.id)
      }

      // 2. create the deck only once; a retry after a later failure reuses it.
      let deckId = createdDeckId
      if (!deckId) {
        const deck = await createDeck({
          name,
          description: deckDescription.trim() || undefined,
          default_template_id: templateId,
        })
        if (!deck) {
          setError(useDeckStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
          return
        }
        deckId = deck.id
        setCreatedDeckId(deck.id)
      }

      // 3. insert ONLY the cards not already saved by a previous attempt, so a
      // retry after a partial insert never duplicates the already-saved cards.
      const remaining = cards.slice(createdCardCount)
      const inserted = remaining.length
        ? await createCards({ deck_id: deckId, template_id: templateId, cards: remaining })
        : 0
      const total = createdCardCount + inserted
      setCreatedCardCount(total)

      if (total < cards.length) {
        setError(useCardStore.getState().error ?? t('decks:quickCreate.errors.createFailed'))
        return
      }

      // The template was written via template-store; invalidate deck-store's
      // separate templates cache so DeckDetail / CardEdit (which resolve the
      // template from deck-store, TTL-gated) refetch and see the new one instead
      // of falling back to a default-template shape.
      useDeckStore.getState().invalidate('templates')
      succeeded.current = true // guard the beforeRemove listener firing during replace
      navigation.replace('DeckDetail', { deckId })
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  return (
    <Screen scroll keyboard testID="quick-create-screen">
      <ScreenHeader title={t('decks:quickCreate.title')} mode="back" />
      <View style={styles.content}>
        {limit.reached && <CardLimitNotice />}
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

        {/* Deck description (optional) */}
        <TextInput
          testID="quick-create-description"
          label={t('decks:quickCreate.deckDescription')}
          placeholder={t('decks:quickCreate.deckDescriptionPlaceholder')}
          value={deckDescription}
          onChangeText={setDeckDescription}
        />

        {/* Card shape picker (by field count) */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            {t('decks:quickCreate.template')}
          </Text>
          <View style={styles.presetGrid}>
            {QUICK_PRESETS.map((p) => {
              const selected = p.id === presetId
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => selectPreset(p.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.presetCard,
                    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                    selected && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
                  ]}
                  testID={`quick-create-preset-${p.id}`}
                >
                  <Text
                    style={[
                      theme.typography.label,
                      { color: selected ? theme.colors.primary : theme.colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {presetSummary(p)}
                    {p.id === QUICK_PRESETS[0].id ? `  · ${t('decks:quickCreate.basicLabel')}` : ''}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Card entry rows */}
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
                {specs.map((spec) => (
                  <TextInput
                    key={spec.key}
                    testID={`quick-create-row-${idx}-${spec.key}`}
                    placeholder={fieldLabel(spec)}
                    value={row[spec.key] ?? ''}
                    onChangeText={(v) => setCell(idx, spec.key, v)}
                    // Distinguish front (accent border) from back (default) at a glance.
                    borderColor={spec.side === 'front' ? theme.colors.primary : theme.colors.border}
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

        <Button
          testID="quick-create-submit"
          title={loading ? t('decks:quickCreate.creating') : t('decks:quickCreate.create')}
          onPress={handleSubmit}
          loading={loading}
          disabled={loading || !deckName.trim()}
        />
        <Button
          testID="quick-create-cancel"
          title={t('decks:quickCreate.cancel')}
          variant="outline"
          onPress={handleCancel}
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
