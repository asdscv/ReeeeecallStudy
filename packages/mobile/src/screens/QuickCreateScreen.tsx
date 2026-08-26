import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, AppState } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useCardStore } from '@reeeeecall/shared/stores/card-store'
import { useTemplateStore } from '@reeeeecall/shared/stores/template-store'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import { aiHubBus } from '@reeeeecall/shared/lib/ai/hub/events'
import { CardLimitNotice } from '../components/CardLimitNotice'
import {
  clearQuickCreateDraft,
  hasQuickCreateContent,
  loadQuickCreateDraft,
  reconcileQuickCreateDraft,
  restoredDeckIsUsable,
  saveQuickCreateDraft,
} from '../utils/quick-create-draft'
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

  const { decks, createDeck, deleteDeck } = useDeckStore()
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

  // ── 작성 중이던 덱 지키기 ───────────────────────────────────────────────
  // 카드 입력 화면과 같은 유실입니다(`card-draft` 참고). 여기가 한 번에 가장 많이 치는
  // 화면이라 잃는 것도 가장 큽니다: 덱 이름·설명·카드 여러 줄. 앱이 포그라운드를 떠날 때
  // 적어 두고, 화면이 뜰 때 되돌려 넣고, 덱을 다 만들었거나 사용자가 스스로 나가면 버립니다.
  //
  // 되살린 '이미 만든 덱' 은 여기서 판단하지 않습니다 — 목록이 도착했는지에 좌우되므로,
  // 정말 필요한 순간인 저장 직전에 `restoredDeckIsUsable` 로 한 번 묻습니다.
  const userTyped = useRef(false)
  const hydrated = useRef(false)
  // 되살려 온 덱 id — 이번 세션에 직접 만든 덱과 구분해야 합니다(직접 만든 것은 방금 확인한
  // 사실이라 다시 물을 필요가 없습니다).
  const [restoredDeckId, setRestoredDeckId] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    ;(async () => {
      const saved = await loadQuickCreateDraft()
      if (!active) return
      hydrated.current = true
      if (!saved || userTyped.current) return
      const draft = reconcileQuickCreateDraft(saved, {
        presetExists: QUICK_PRESETS.some((p) => p.id === saved.presetId),
      })
      setDeckName(draft.deckName)
      setDeckDescription(draft.deckDescription)
      if (QUICK_PRESETS.some((p) => p.id === draft.presetId)) setPresetId(draft.presetId)
      setRows(draft.rows.length > 0 ? draft.rows : emptyRows())
      setCreatedDeckId(draft.createdDeckId)
      setCreatedCardCount(draft.createdCardCount)
      setRestoredDeckId(draft.createdDeckId)
    })()
    return () => {
      active = false
    }
  }, [])

  // AppState 리스너가 최신 입력을 보되 한 글자마다 구독을 새로 걸지 않도록.
  const latestEntry = useRef({ deckName, deckDescription, presetId, rows, createdDeckId, createdCardCount })
  latestEntry.current = { deckName, deckDescription, presetId, rows, createdDeckId, createdCardCount }
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return
      // 프로세스가 실제로 끝나는 시점에는 실행될 JS 가 없습니다 — 나가는 길에 찍습니다.
      const e = latestEntry.current
      if (hasQuickCreateContent(e.deckName, e.deckDescription, e.rows)) {
        void saveQuickCreateDraft({
          deckName: e.deckName,
          deckDescription: e.deckDescription,
          presetId: e.presetId,
          rows: e.rows,
          createdDeckId: e.createdDeckId,
          createdCardCount: e.createdCardCount,
        })
      } else if (hydrated.current) {
        // 비운 폼은 되살릴 것이 없습니다. 단 읽어보기도 전이라면 손대지 않습니다 —
        // 앱이 막 뜬 직후의 빈 폼을 근거로 지우면 저장해 둔 것을 앱이 지웁니다.
        void clearQuickCreateDraft()
      }
    })
    return () => sub.remove()
  }, [])

  const markTyped = () => { userTyped.current = true }

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
    const unsub = navigation.addListener('beforeRemove', (e) => {
      cleanupOrphanDeck()
      // 뒤로 나가는 것만 "버리기"입니다. 화면이 앱 사정으로 치워지는 경우(내비게이션
      // 복원·리셋)까지 버리면 구해 둔 글을 사용자가 아니라 앱이 지웁니다.
      const type = e.data.action.type
      if (type === 'GO_BACK' || type === 'POP' || type === 'POP_TO_TOP') void clearQuickCreateDraft()
    })
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
  const setCell = (rowIdx: number, key: string, value: string) => {
    markTyped()
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)))
  }
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
      // 되살려 온 덱 흔적이라면 아직 그 덱이 있는지 여기서 한 번 확인합니다 — 하루 전에
      // 만들어 둔 덱은 그새 지워졌을 수 있고, 없는 덱에 카드를 넣으려 하면 이 화면에서
      // 빠져나올 수 없습니다.
      if (deckId && deckId === restoredDeckId && !restoredDeckIsUsable(deckId, decks.map((d) => d.id))) {
        deckId = null
        setCreatedDeckId(null)
        setCreatedCardCount(0)
        setRestoredDeckId(null)
      }
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
      // 위에서 흔적을 버렸다면 처음부터 다시 넣습니다 (setState 는 아직 반영 전이라 deckId 로 판단).
      const alreadyInserted = deckId === createdDeckId ? createdCardCount : 0
      const remaining = cards.slice(alreadyInserted)
      const inserted = remaining.length
        ? await createCards({ deck_id: deckId, template_id: templateId, cards: remaining })
        : 0
      const total = alreadyInserted + inserted
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
      void clearQuickCreateDraft()
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
          onChangeText={(v) => { markTyped(); setDeckName(v) }}
          autoFocus
        />

        {/* Deck description (optional) */}
        <TextInput
          testID="quick-create-description"
          label={t('decks:quickCreate.deckDescription')}
          placeholder={t('decks:quickCreate.deckDescriptionPlaceholder')}
          value={deckDescription}
          onChangeText={(v) => { markTyped(); setDeckDescription(v) }}
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

        {/* The other place a deck is born. Ghost, and last, so the type-it-in flow this screen
            exists for keeps every bit of its speed. */}
        <Button
          testID="quick-create-ai-generate"
          title={`🤖 ${t('decks:aiGenerate')}`}
          variant="ghost"
          onPress={() => {
            aiHubBus.emit({ type: 'ai_hub.generate_requested', mode: 'full', source: 'quick_create' })
            const tabNav = navigation.getParent()
            if (tabNav) tabNav.navigate('AITab', { screen: 'AIGenerate', params: { mode: 'full' } })
          }}
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
