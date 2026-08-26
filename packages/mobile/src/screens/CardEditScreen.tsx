import { useState, useEffect, useRef } from 'react'
import { View, Text, Alert, StyleSheet, AppState } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { useCards } from '../hooks/useCards'
import { useDecks } from '../hooks/useDecks'
import { useTheme } from '../theme'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useCardStore } from '@reeeeecall/shared/stores/card-store'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import { aiHubBus } from '@reeeeecall/shared/lib/ai/hub/events'
import { cardLength } from '@reeeeecall/shared/lib/card-content-limits'
import { testProps } from '../utils/testProps'
import { cardDraftKey, clearCardDraft, hasDraftContent, loadCardDraft, saveCardDraft } from '../utils/card-draft'
import type { CardTemplate } from '@reeeeecall/shared/types/database'
import { getMobileSupabase } from '../adapters'
import type { DecksStackParamList } from '../navigation/types'

/**
 * 템플릿이 정해지기를 기다려 주는 한도. 이 시간이 지나면 폴백 폼이라도 내줍니다 —
 * 답이 영영 오지 않는 경우(오프라인, 세션 갱신 실패)에 막힌 화면을 남기지 않기 위해서.
 */
const TEMPLATE_SETTLE_TIMEOUT_MS = 5000

type Nav = NativeStackNavigationProp<DecksStackParamList, 'CardEdit'>
type Route = RouteProp<DecksStackParamList, 'CardEdit'>

export function CardEditScreen() {
  const theme = useTheme()
  const { t } = useTranslation(['decks', 'common'])
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

  // 템플릿이 "아직 정해지는 중"인지 "정할 것이 없는지" — 이 구분이 없으면 답이 나오기도
  // 전에 앞/뒤 폴백 폼이 먼저 그려지고, 두 가지가 깨집니다.
  //  (1) 되살린 draft 는 템플릿 필드 키(field_1…)에 담겨 있어 폴백 폼에서는 빈 칸으로
  //      보입니다. 앱이 재시작된 직후 5~10초 동안(에뮬레이터 실측), 구해 둔 글이 그대로
  //      사라진 것처럼 보입니다 — 구하려던 바로 그 장면입니다.
  //  (2) 그 사이에 입력하면 템플릿과 맞지 않는 키로 저장돼, 카드를 다시 열면 비어 있습니다.
  //      heal-before-render 가 존재하는 바로 그 이유입니다.
  // 그래서 답이 나오기 전에는 폼 대신 로딩 자리를 둡니다.
  const [templateSettled, setTemplateSettled] = useState(false)
  // 다만 영원히 기다리지는 않습니다. 폴백 폼이라도 있는 편이 막힌 화면보다 낫습니다.
  useEffect(() => {
    const timer = setTimeout(() => setTemplateSettled(true), TEMPLATE_SETTLE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])
  // 편집 모드에는 heal 이 없습니다 — 카드가 자기 템플릿을 가리키므로, 목록이 도착하면 답이 나온 것.
  useEffect(() => {
    if (isEditing && templates.length > 0) setTemplateSettled(true)
  }, [isEditing, templates.length])
  const templateResolving = fields.length === 0 && !templateSettled

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

  // ── 작성 중이던 카드 지키기 ──────────────────────────────────────────────
  // 다른 앱에 갔다 돌아오면 쓰던 게 다 사라졌습니다. 백그라운드로 내려간 앱은
  // 살아 있으리라는 보장이 없고(메모리 회수), 프로세스가 다시 뜨면
  // `nav-persistence` 가 사용자를 이 화면으로 정확히 되돌려 놓습니다 — 그래서
  // 손실이 더 또렷했습니다. 같은 카드 입력 화면에, 칸은 전부 비어서.
  //
  // 내비게이션 상태가 "어디 있었는지"라면, 아래 draft 는 "무엇을 쓰고 있었는지"입니다.
  // 앱이 포그라운드를 떠날 때 적어두고, 화면이 뜰 때 되돌려 넣고, 저장했거나
  // 사용자가 스스로 화면을 나가는 순간 버립니다.
  const draftKey = cardDraftKey(deckId, cardId)
  // draft 를 부어넣는 즉시(동기적으로) 표시해 둡니다. 아래 seed 효과가 이걸 보고
  // 물러나야 합니다 — 스토어의 카드 행은 draft 로드보다 먼저 올 수도, 나중에 올
  // 수도 있으므로 순서에 기대면 안 됩니다.
  const draftApplied = useRef(false)
  // 사용자가 이 화면에서 실제로 타이핑했는지. 파일 읽기가 첫 타이핑보다 늦게 끝나면
  // 복원이 방금 친 글자를 덮어씁니다 — 구하려던 것을 잃게 하는 셈입니다.
  const userTyped = useRef(false)
  // 저장된 draft 를 한 번이라도 읽어봤는지. 읽어보기 전에는 빈 폼을 근거로 아무 것도
  // 지우지 않습니다 (아래 AppState 처리 참고).
  const hydrated = useRef(false)
  useEffect(() => {
    let active = true
    ;(async () => {
      const draft = await loadCardDraft(draftKey)
      if (!active) return
      hydrated.current = true
      if (!draft || userTyped.current) return
      draftApplied.current = true
      setFieldValues(draft.fieldValues)
      setTags(draft.tags)
    })()
    return () => {
      active = false
    }
  }, [draftKey])

  // AppState 리스너는 최신 입력값을 봐야 하지만, 한 글자마다 구독을 새로 걸 수는
  // 없습니다. ref 로 최신값만 흘려보냅니다.
  const latestEntry = useRef({ fieldValues, tags })
  latestEntry.current = { fieldValues, tags }
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return
      // 'background' 뿐 아니라 'inactive'(iOS 앱 전환기·전화 수신)에서도 적어둡니다.
      // 프로세스가 실제로 종료되는 시점에는 실행될 JS 가 남아 있지 않으므로,
      // 스냅샷은 나가는 길에 찍어야 합니다.
      const { fieldValues: values, tags: tagText } = latestEntry.current
      if (hasDraftContent(values, tagText)) void saveCardDraft(draftKey, values, tagText)
      // 비워둔 폼은 복원할 것이 없습니다 — 남은 draft 만 치웁니다. 단, 아직 draft 를
      // 읽어보기도 전이라면 손대지 않습니다: 앱이 막 뜬 직후의 빈 폼을 근거로 지우면
      // 저장해 둔 글을 사용자가 아니라 앱이 지웁니다(에뮬레이터에서 실제로 그렇게 사라졌습니다).
      else if (hydrated.current) void clearCardDraft()
    })
    return () => sub.remove()
  }, [draftKey])

  // 화면에서 스스로 나가는 것은 "버리기"입니다(지금까지도 그랬습니다). draft 가
  // 남는 경우는 앱이 사라진 경우뿐이어서, 취소한 카드가 다음 '카드 추가' 화면에
  // 되살아나는 일은 없습니다.
  useEffect(
    () => navigation.addListener('beforeRemove', (e) => {
      // 뒤로 나가는 것만 "버리기"입니다. 화면이 앱 사정으로 치워지는 경우(내비게이션
      // 복원·리셋·딥링크)까지 버리면 구해 둔 글을 사용자가 아니라 앱이 지우게 됩니다.
      const type = e.data.action.type
      if (type === 'GO_BACK' || type === 'POP' || type === 'POP_TO_TOP') void clearCardDraft()
    }),
    [navigation],
  )

  // Seed the form from the stored card — ONCE per card, and never over a draft.
  //
  // Keyed on the `card` OBJECT, this re-ran on every refetch: the store hands back
  // new row objects each time a deck's card list is re-read (focus refetch after any
  // card/study mutation invalidated the cache), so a refetch landing mid-edit reset
  // the form to the stored values and threw away everything typed since. Seeding is
  // a one-time job — "the row I opened", not "the row as it currently reads".
  const seededCardId = useRef<string | null>(null)
  useEffect(() => {
    if (!card) return
    if (draftApplied.current) return
    if (seededCardId.current === card.id) return
    seededCardId.current = card.id
    setFieldValues(card.field_values)
    setTags(card.tags?.join(', ') ?? '')
  }, [card])

  // Heal-before-render: in create mode, if the deck has no resolvable template,
  // seed defaults + adopt the first default + persist it on the deck up front,
  // then set it into state so the form renders the real template fields (and the
  // user types into the correct field keys). Save-time resolveTemplateId() stays
  // as a fallback but is no longer the primary path.
  useEffect(() => {
    if (isEditing) return // editing an existing card always has its own template
    if (listTemplate || healedTemplate) return // already resolved
    // 사용자를 알기 전에는 결론을 내지 않습니다 — 아래 조회가 user_id 로 거르므로,
    // currentUserId 가 없는 동안 도는 것은 반드시 빈손으로 끝나는 왕복입니다.
    if (!currentUserId) return
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
      if (!active) return
      if (fallback) {
        // Persist on the deck so future cards resolve a template without re-healing.
        if (deck && !deck.default_template_id) {
          await updateDeck(deckId, { default_template_id: fallback.id })
        }
        if (active) setHealedTemplate(fallback)
      }
      // 붙였든, 붙일 것이 없든 — 답은 나왔습니다.
      if (active) setTemplateSettled(true)
    })()
    return () => {
      active = false
    }
    // deckId keys the heal; deck/listTemplate update as the stores load.
  }, [isEditing, listTemplate, healedTemplate, deck, deckId, ensureDefaultTemplates, updateDeck, currentUserId])

  const setField = (key: string, value: string) => {
    userTyped.current = true
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }
  const setTagsTyped = (value: string) => {
    userTyped.current = true
    setTags(value)
  }

  const hasContent = Object.values(fieldValues).some((v) => v.trim())
  /**
   * 카드 전체 글자수 — 지금 몇 자 / 몇 자까지.
   *
   * 한도는 카드 한 장에 걸립니다(필드별이면 필드를 늘려 우회됩니다). 이미지 필드는 데이터
   * URL 이라 혼자 수만 자이고 학습자가 쓴 글이 아니므로 세지 않습니다.
   */
  const cardChars = cardLength(
    fields.filter((f) => f.type !== 'image').map((f) => fieldValues[f.key] ?? ''),
  )

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

  // createCard returns null (does NOT throw) for MANY reasons — card limit, the
  // 30/min rate limit, readonly, transient. Surface the REAL error, not a hardcoded
  // "subscribe" prompt that would push a wrong purchase for a mere rate-limit.
  const alertCreateError = () => {
    const err = useCardStore.getState().error
    Alert.alert(t('cardEdit.errorTitle'), tLimit(err ?? 'errors:card.limitReached', { defaultValue: t('cardEdit.saveError') }))
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
        // createCard returns null (does NOT throw) on failure — incl. a card-limit
        // (mig 116) rejection at the boundary. Don't goBack as if it saved.
        const created = await createCard({
          deck_id: deckId,
          template_id: resolvedTemplateId,
          field_values: fieldValues,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        })
        if (!created) { alertCreateError(); return }
      }
      void clearCardDraft()
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

        {/* 지금 몇 자 / 몇 자까지. 저장을 누른 뒤에 알게 되는 한도는 한도가 아닙니다. */}
        <Text
          style={[theme.typography.caption, {
            textAlign: 'right',
            color: cardChars.state === 'too_long' ? theme.colors.error
              : cardChars.state === 'near_limit' ? theme.colors.warning
                : theme.colors.textTertiary,
          }]}
          {...testProps('card-length')}
        >
          {t('cardEdit.length', { chars: cardChars.count, max: cardChars.max })}
        </Text>

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
        ) : templateResolving ? (
          // 답이 나오기 전에는 폼을 그리지 않습니다 (위 templateSettled 참고).
          <Text
            style={[theme.typography.body, { color: theme.colors.textSecondary, paddingVertical: 24, textAlign: 'center' }]}
            {...testProps('card-edit-fields-loading')}
          >
            {t('common:loading')}
          </Text>
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
          onChangeText={setTagsTyped}
          hint={t('cardEdit.tagsHint')}
        />

        <Button
          testID="card-edit-save"
          title={isEditing ? t('cardEdit.save') : t('cardEdit.add')}
          onPress={handleSave}
          loading={saving}
          disabled={!hasContent || !cardChars.savable}
        />

        {/* Add another button (create mode only) */}
        {!isEditing && (
          <Button
            testID="card-edit-save-another"
            title={t('cardEdit.addAnother')}
            variant="outline"
            onPress={async () => {
              if (!hasContent) return
              // Owned-card limit pre-flight (mig 116) — this "Add another" path had none.
              if (limit.reached) {
                Alert.alert(tLimit('errors:card.limitReached'), tLimit('settings:cardUsage.reached'))
                return
              }
              setSaving(true)
              try {
                const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean)
                const resolvedTemplateId = await resolveTemplateId()
                if (!resolvedTemplateId) {
                  Alert.alert(t('cardEdit.errorTitle'), t('cardEdit.noTemplateError'))
                  return
                }
                // createCard returns null (no throw) on failure — don't clear the form
                // as if it saved (was the "silent false-success" the earlier pass missed).
                const created = await createCard({
                  deck_id: deckId,
                  template_id: resolvedTemplateId,
                  field_values: fieldValues,
                  tags: parsedTags.length > 0 ? parsedTags : undefined,
                })
                if (!created) { alertCreateError(); return }
                // Reset form — and drop the draft with it, or a kill right after
                // "하나 더" would restore the card that was just saved.
                setFieldValues({})
                setTags('')
                void clearCardDraft()
              } catch {
                Alert.alert(t('cardEdit.errorTitle'), t('cardEdit.saveError'))
              } finally {
                setSaving(false)
              }
            }}
            loading={saving}
            disabled={!hasContent || !cardChars.savable}
          />
        )}

        {/* Create mode only: the same cards, generated into THIS deck. Ghost so it stays behind
            both save buttons — typing a card by hand must stay the fastest path. Keyed on the
            route param, not `isEditing`: the card row arrives a beat after mount, and this must
            not flash while editing one. */}
        {/* `!deck?.is_readonly` and not just `!cardId`: a read-only deck cannot receive generated
            cards, and the AI screen drops the deck as soon as its owned-and-editable list loads —
            so on a subscribed deck this button would quietly reopen the wizard on 전체 생성. Seen
            on a simulator against an official deck. */}
        {!cardId && !deck?.is_readonly && (
          <Button
            testID="card-edit-ai-cards"
            title={`🤖 ${t('detail.aiCards')}`}
            variant="ghost"
            onPress={() => {
              aiHubBus.emit({ type: 'ai_hub.generate_requested', mode: 'cards_only', source: 'card_create', deckId })
              const tabNav = navigation.getParent()
              if (tabNav) {
                tabNav.navigate('AITab', {
                  screen: 'AIGenerate',
                  params: { deckId, mode: 'cards_only', templateId: deck?.default_template_id ?? undefined },
                })
              }
            }}
          />
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },

})
