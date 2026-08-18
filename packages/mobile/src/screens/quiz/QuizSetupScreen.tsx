import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { AI_HUB_QUIZ } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { AiCreditNotice } from '../../components/ai/AiCreditNotice'
import {
  useQuizStore, QuizError, QUIZ_GENERATE_ACTION,
  type QuizQuestionType, type QuizQuote, type QuizzableCount, type QuizDifficultyBand,
} from '@reeeeecall/shared/stores/quiz-store'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { Screen, Button, ScreenHeader } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import type { QuizStackParamList } from '../../navigation/types'
import { generateCostLine, freeLeftLine, affordableQuestionCount } from '@reeeeecall/shared/lib/quiz-pricing'
import { minCardsForMcq } from '@reeeeecall/shared/lib/quiz-outcome'

type Nav = NativeStackNavigationProp<QuizStackParamList, 'QuizSetup'>

const TYPES: QuizQuestionType[] = ['mcq', 'short', 'essay']
// Same presets as web. Mobile has no free-entry field: a numeric keyboard for a value that
// is almost always one of these is worse than one more chip.
// 서버가 실제로 받는 길이만 보여 줍니다. 30·50 은 스키마가 12 로 막고 있는 동안에도
// 화면에 있었고, 고르면 원시 제약 위반(23514)이 돌아왔습니다. 264 가 20 까지 열었고,
// 그 위는 스키마가 아니라 생성 구조 이야기입니다 — 서술형 50문항은 17배치입니다.
// `quiz-count-options.test.ts` 가 이 목록을 마이그레이션의 상한에 붙들어 둡니다.
const COUNTS = [4, 6, 8, 10, 12, 16, 20]
/** Ceiling for the custom box. Matches web's MAX_COUNT and the server's per-set cap. */
// 직접 입력의 상한. **칩과 같은 숫자여야 합니다.**
//
// 칩은 264 에서 20 까지로 맞췄는데 이 상자만 50 으로 남아 있었습니다 — 시뮬레이터에서 화면을
// 보고 찾았습니다("직접 입력 1–50"). 21 을 타이핑하면 `create_quiz_set` 이 원시 제약 위반
// (23514)으로 거절합니다. 칩에서 고친 defect 를 상자가 그대로 갖고 있었던 것입니다.
// `quiz-count-options.test.ts` 가 이 값을 마이그레이션의 상한에 붙들어 둡니다.
const MAX_COUNT = 20

/**
 * Scope, type, count, price, confirm.
 *
 * The price shown is the SERVER's (`get_ai_quiz_quote`) and is passed straight back as
 * `maxPriceMicro`. The client never multiplies a unit price itself — otherwise "you approved
 * this" would be a client-side belief instead of a server-checked fact.
 */
export function QuizSetupScreen() {
  const theme = useTheme()
  const { t, i18n } = useTranslation('quiz')
  const navigation = useNavigation<Nav>()
  const { decks, fetchDecks } = useDeckStore()
  const {
    countQuizzable, quote, createAndGenerate, generating, generateProgress, difficultyLevels,
  } = useQuizStore()

  const [deckId, setDeckId] = useState('')
  const [type, setType] = useState<QuizQuestionType>('mcq')
  const [count, setCount] = useState(6)
  // Keyed by deck rather than cleared in an effect: a synchronous setState inside an effect
  // is a cascading render, and an unkeyed value would flash the previous deck's numbers.
  const [counts, setCounts] = useState<{ deckId: string; value: QuizzableCount } | null>(null)
  const [priced, setPriced] = useState<QuizQuote | null>(null)
  // Listed from the server, never enumerated here: a band is a row, so a new one shows up
  // without a deploy.
  const [bands, setBands] = useState<QuizDifficultyBand[]>([])
  // No initial level. Until the learner picks one, the band is whichever row the server
  // marked `is_default` — hardcoding 3 here overrode that silently on every fresh screen.
  const [difficulty, setDifficulty] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void fetchDecks() }, [fetchDecks])
  useEffect(() => { void difficultyLevels().then(setBands).catch(() => setBands([])) }, [difficultyLevels])

  useEffect(() => {
    if (!deckId) return
    let cancelled = false
    void countQuizzable(deckId)
      .then((value) => { if (!cancelled) setCounts({ deckId, value }) })
      .catch(() => { if (!cancelled) setCounts(null) })
    return () => { cancelled = true }
  }, [deckId, countQuizzable])

  const shownCounts = counts?.deckId === deckId ? counts.value : null

  const refreshQuote = useCallback(() => {
    let cancelled = false
    void quote(QUIZ_GENERATE_ACTION[type], count)
      .then((q) => { if (!cancelled) setPriced(q) })
      .catch(() => { if (!cancelled) setPriced(null) })
    return () => { cancelled = true }
  }, [quote, type, count])

  useEffect(() => refreshQuote(), [refreshQuote])

  const usableBands = bands.filter((b) => !b.types || b.types.includes(type))
  // Switching type can strip the chosen band. Derived rather than corrected in an effect —
  // a setState inside an effect is a cascading render, and the fallback is the band the
  // server marked default.
  const activeBand = difficulty !== null && usableBands.some((b) => b.level === difficulty)
    ? difficulty
    : (usableBands.find((b) => b.is_default) ?? usableBands[0])?.level ?? null
  const eligible = shownCounts?.eligible ?? 0
  /** The chosen count is not one of the chips, so the custom box is what is in effect. */
  const isCustomCount = !COUNTS.includes(count)
  // From the BAND, not a literal 4. The far distractor slots are what need deck-mates, and the
  // band says how many there are — at the hardest one the model writes every distractor, so a
  // six-card deck was being refused for cards it did not need.
  const mcqMinimum = minCardsForMcq(usableBands.find((b) => b.level === activeBand))
  const tooFewForMcq = type === 'mcq' && eligible > 0 && eligible < mcqMinimum
  const costLine = generateCostLine(priced)
  const freeLeft = freeLeftLine(priced)
  const canSubmit = Boolean(deckId) && eligible > 0 && !tooFewForMcq && !generating
    && priced !== null && priced.sufficient
  /** 지금 값을 치를 수 있는 문항 수. 전부 안 될 때만 의미가 있습니다. */
  const affordable = affordableQuestionCount(priced, count)

  const submit = async () => {
    if (!priced || !deckId) return
    setError(null)
    try {
      const deck = decks.find((d) => d.id === deckId)
      await createAndGenerate({
        deckId,
        title: deck?.name ?? t('setup.untitled'),
        questionType: type,
        count: Math.min(count, eligible),
        locale: i18n.language.split('-')[0],
        // May be null before the band list has loaded; the server then applies its own
        // default rather than being handed a guess.
        difficulty: activeBand ?? undefined,
        maxPriceMicro: priced.price_micro,
        // The quote's own split, so the batch drawdown can follow the server's
        // trial -> free -> paid order instead of guessing pro-rata. Without it the
        // final batch is refused whenever free questions remain.
        freeQuestions: (priced.free_items ?? 0) + (priced.trial_items ?? 0),
        paidQuestions: priced.paid_items ?? 0,
      })
      navigation.navigate('QuizHome')
    } catch (e) {
      const code = e instanceof QuizError ? e.code : 'UNKNOWN'
      setError(t(`error.${code}`))
      if (code === 'AI_PRICE_CHANGED') refreshQuote()
    }
  }

  const chip = (selected: boolean) => ({
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
    borderColor: selected ? theme.colors.primary : theme.colors.border,
    backgroundColor: selected ? theme.colors.primary : 'transparent',
  })

  return (
    <Screen>
      <ScreenHeader title={t('setup.title')} mode="back" onBack={() => navigation.goBack()} />
      {/* The same notice every AI screen shows, from one rule. Placed by feature id so it
          follows `hub/catalog.ts` rather than this file. */}
      <AiCreditNotice featureId={AI_HUB_QUIZ} style={{ marginHorizontal: 16, marginBottom: 12 }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('setup.deck')}</Text>
        <View style={styles.row}>
          {decks.map((deck) => (
            <Pressable key={deck.id} onPress={() => setDeckId(deck.id)} style={chip(deckId === deck.id)}
              {...testProps(`quiz-deck-${deck.id}`)}>
              <Text style={[theme.typography.caption, { color: deckId === deck.id ? '#fff' : theme.colors.text }]}>
                {deck.name}
              </Text>
            </Pressable>
          ))}
        </View>

        {shownCounts && (eligible === 0 ? (
          <View style={[styles.warn, { borderColor: theme.colors.error }]}
            {...testProps('quiz-no-eligible')}>
            <Text style={[theme.typography.label, { color: theme.colors.error }]}>
              {t('setup.noEligible.title', { total: shownCounts.total })}
            </Text>
            {/* Fixable, and the learner owns the fix: the template never marked which back
                field is the answer. */}
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {t('setup.noEligible.body')}
            </Text>
          </View>
        ) : (
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}
            {...testProps('quiz-eligible-note')}>
            {t('setup.eligible', { eligible, total: shownCounts.total })}
          </Text>
        ))}

        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('setup.type')}</Text>
        <View style={styles.row}>
          {TYPES.map((option) => (
            <Pressable key={option} onPress={() => setType(option)} style={chip(type === option)}>
              <Text style={[theme.typography.caption, { color: type === option ? '#fff' : theme.colors.text }]}>
                {t(`type.${option}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          {t(`setup.typeHint.${type}`)}
        </Text>

        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('setup.count')}</Text>
        <View style={styles.row}>
          {COUNTS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setCount(option)}
              disabled={eligible > 0 && option > eligible}
              // 실기 테스트가 "덱이 감당 못 하는 길이는 눌리지 않는다"를 확인하는 앵커입니다.
              {...testProps(`quiz-count-${option}`)}
              style={[chip(count === option), { opacity: eligible > 0 && option > eligible ? 0.4 : 1 }]}
            >
              <Text style={[theme.typography.caption, { color: count === option ? '#fff' : theme.colors.text }]}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Parity with web, which had a custom box and phones did not — a learner who wanted 13
            questions simply could not ask for one here. Kept OUT of the chip row and labelled:
            web's version sat inline as a ninth chip that always echoed the count, so typing 13
            highlighted nothing and typing 6 lit up the 6 chip. Empty unless the count really is
            custom, outlined when it is the thing in effect. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {t('setup.customCount')}
          </Text>
          <TextInput
            value={isCustomCount ? String(count) : ''}
            onChangeText={(raw) => {
              if (raw.trim() === '') return
              const n = Number(raw.replace(/[^0-9]/g, ''))
              if (Number.isFinite(n) && n > 0) setCount(Math.min(MAX_COUNT, Math.max(1, Math.round(n))))
            }}
            keyboardType="number-pad"
            placeholder={`1–${MAX_COUNT}`}
            placeholderTextColor={theme.colors.textTertiary}
            style={{
              width: 76, minHeight: 40, textAlign: 'center', borderRadius: 10, borderWidth: 1,
              paddingHorizontal: 8, color: theme.colors.text,
              borderColor: isCustomCount ? theme.colors.primary : theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
            {...testProps('quiz-count-custom')}
          />
          {/* One place says what will actually be made, whichever control set it. */}
          <Text
            style={[theme.typography.caption, { color: theme.colors.textTertiary }]}
            {...testProps('quiz-count-effective')}
          >
            {t('setup.countEffective', { count: Math.min(count, eligible || count) })}
          </Text>
        </View>

        {/* The submit clamps to `eligible`, and on a deck smaller than the smallest chip every
            chip is disabled — so the screen showed a count nobody could change and then quietly
            made a different number. Say the real number instead. */}
        {eligible > 0 && eligible < count && (
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {t('setup.clampedCount', { count: eligible })}
          </Text>
        )}

        {/* Every type has a band since mig 202: difficulty is an instruction the band
            carries per question type, not a count of near-miss options. */}
        {usableBands.length > 0 && (
          <>
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {t('setup.difficulty')}
            </Text>
            <View style={styles.row}>
              {usableBands.map((band) => (
                <Pressable key={band.level} onPress={() => setDifficulty(band.level)} style={chip(activeBand === band.level)}>
                  <Text style={[theme.typography.caption, { color: activeBand === band.level ? '#fff' : theme.colors.text }]}>
                    {t(`difficulty.${band.level}`, { defaultValue: t('difficulty.generic', { level: band.level }) })}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {t(`difficultyHint.${type}.${activeBand}`, { defaultValue: '' })}
            </Text>
          </>
        )}

        {tooFewForMcq && (
          <Text style={[theme.typography.caption, { color: theme.colors.error }]}>
            {t('setup.tooFewForMcq', { count: eligible })}
          </Text>
        )}

        {/* What this batch costs, and what is left of today's free questions.
            An allowance nobody can see is not an allowance: the free tier gets five questions a
            day whatever the type, and until 239 the only way to find that out was to be charged
            for the sixth. Both lines come from the shared helper so web and mobile cannot start
            explaining the same billing differently. */}
        {costLine && (
          <View style={[styles.priceBox, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.caption, { color: theme.colors.text }]} testID="quiz-generate-cost">
              {t(costLine.key, costLine.params)}
            </Text>
            {freeLeft && (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]} testID="quiz-free-left">
                {t(freeLeft.key, freeLeft.params)}
              </Text>
            )}
          </View>
        )}

        {priced && !priced.sufficient && (
          <View style={[styles.priceBox, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.caption, { color: theme.colors.error }]}>
              {t('error.AI_INSUFFICIENT_CREDITS')}
            </Text>
            {/* 숫자와, 그것을 집는 방법. 예약은 설계상 전부 아니면 전무라(값을 미리 합의하니까),
                무료 5문항이 남은 학습자가 10문항을 고르면 5개도 못 받았습니다 — 정확히 5를
                찍어야만 됐습니다. 이제 화면이 그 수를 말하고 한 번에 집어줍니다. */}
            {affordable > 0 && (
              <Pressable
                onPress={() => setCount(affordable)}
                style={{ marginTop: 8, alignSelf: 'flex-start' }}
                accessibilityRole="button"
                {...testProps('quiz-use-affordable')}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
                  {t('setup.makeAffordable', { count: affordable })}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {error && (
          <Text style={[theme.typography.caption, { color: theme.colors.error }]}>{error}</Text>
        )}

        <Button
          title={generating
            // A 50-question quiz is several model calls and can take over a minute. The web
            // button has counted batches since 208; this one said "만드는 중…" for the whole
            // wait, which on a phone — where there is nothing else on screen to look at —
            // reads as a hang. `generateProgress` was being written and never read here.
            ? (generateProgress && generateProgress.total > 1
              ? t('setup.generatingBatch', {
                done: generateProgress.done, total: generateProgress.total,
              })
              : t('setup.generating'))
            : t('setup.confirm')}
          onPress={() => void submit()}
          disabled={!canSubmit}
          {...testProps('quiz-confirm')}
        />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 32 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warn: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 2 },
  priceBox: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 4 },
})
