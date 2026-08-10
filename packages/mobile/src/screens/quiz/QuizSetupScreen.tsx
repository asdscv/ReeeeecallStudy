import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import {
  useQuizStore, QuizError, QUIZ_GENERATE_ACTION,
  type QuizQuestionType, type QuizQuote, type QuizzableCount, type QuizDifficultyBand,
} from '@reeeeecall/shared/stores/quiz-store'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { Screen, Button, ScreenHeader } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import type { QuizStackParamList } from '../../navigation/types'

type Nav = NativeStackNavigationProp<QuizStackParamList, 'QuizSetup'>

const TYPES: QuizQuestionType[] = ['mcq', 'short', 'essay']
const COUNTS = [4, 6, 8, 10, 12]

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
  const { countQuizzable, quote, createAndGenerate, generating, difficultyLevels } = useQuizStore()

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
  const tooFewForMcq = type === 'mcq' && eligible > 0 && eligible < 4
  const canSubmit = Boolean(deckId) && eligible > 0 && !tooFewForMcq && !generating
    && priced !== null && priced.sufficient

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
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t('setup.deck')}</Text>
        <View style={styles.row}>
          {decks.map((deck) => (
            <Pressable key={deck.id} onPress={() => setDeckId(deck.id)} style={chip(deckId === deck.id)}>
              <Text style={[theme.typography.caption, { color: deckId === deck.id ? '#fff' : theme.colors.text }]}>
                {deck.name}
              </Text>
            </Pressable>
          ))}
        </View>

        {shownCounts && (eligible === 0 ? (
          <View style={[styles.warn, { borderColor: theme.colors.error }]}>
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
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
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
              style={[chip(count === option), { opacity: eligible > 0 && option > eligible ? 0.4 : 1 }]}
            >
              <Text style={[theme.typography.caption, { color: count === option ? '#fff' : theme.colors.text }]}>
                {option}
              </Text>
            </Pressable>
          ))}
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

        {priced && (
          <View style={[styles.priceBox, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <View style={styles.priceRow}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('setup.price')}</Text>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                {priced.price_micro === 0 ? t('setup.free') : formatUsdMicro(priced.price_micro)}
              </Text>
            </View>
            {(priced.trial_units > 0 || priced.free_units > 0) && (
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {t('setup.covered', { units: priced.trial_units + priced.free_units })}
              </Text>
            )}
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {t('setup.retakeFree')}
            </Text>
            {!priced.sufficient && (
              <Text style={[theme.typography.caption, { color: theme.colors.error }]}>
                {t('error.AI_INSUFFICIENT_CREDITS')}
              </Text>
            )}
          </View>
        )}

        {error && (
          <Text style={[theme.typography.caption, { color: theme.colors.error }]}>{error}</Text>
        )}

        <Button
          title={generating ? t('setup.generating') : t('setup.confirm')}
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
  priceRow: { flexDirection: 'row', justifyContent: 'space-between' },
})
