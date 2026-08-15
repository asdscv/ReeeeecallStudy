import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useQuizStore, mistakeResponseText, groupMistakesByDeck } from '@reeeeecall/shared/stores/quiz-store'
import { useStudy } from '../../hooks/useStudy'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'

/**
 * 오답 노트 — what you got wrong, and the one thing to do about it.
 *
 * Every wrong quiz answer was already being recorded: `answer_attempts` carries the card, the
 * response, the score and the run item, and nothing ever read it back. A learner could miss the
 * same card five sittings running and the app would never say so.
 *
 * Grouped by deck, because that is the unit a study session takes — cards from two decks cannot
 * be one session, and a flat list would offer a button that cannot work. One row per card: a card
 * missed four times is one card to restudy, not four copies of the same stem.
 *
 * It reschedules nothing on its own. A quiz answer silently moving SRS reviews would let one
 * casual sitting rearrange weeks of study, so the misses are shown and the decision to study them
 * stays the learner's — `startCardSession` is SRS, so choosing it DOES move the schedule.
 */
export function QuizMistakes() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation()
  const { mistakes, loadMistakes } = useQuizStore()
  const { startCardSession } = useStudy()
  const [expanded, setExpanded] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => { void loadMistakes(undefined, 50).catch(() => {}) }, [loadMistakes])

  // Shared with the other platform: two copies of "which card, which deck, how many times" is
  // two places for the list and the study button to start disagreeing.
  const decks = useMemo(() => groupMistakesByDeck(mistakes), [mistakes])

  const studyDeck = useCallback(async (deckId: string, cardIds: string[]) => {
    setStarting(true)
    try {
      await startCardSession(deckId, cardIds)
      // Cross-stack, the shape the diagnostics panel uses: `StudySession` lives in the Study
      // tab's stack while quiz lives in its own.
      const tabNav = navigation.getParent() as unknown as
        { navigate: (name: string, params?: unknown) => void } | undefined
      tabNav?.navigate('StudyTab', { screen: 'StudySession' })
    } catch {
      // Leaving the list on screen is the honest failure: nothing was lost, and the learner can
      // open the deck themselves.
    } finally {
      setStarting(false)
    }
  }, [navigation, startCardSession])

  const total = decks.reduce((n, d) => n + d.items.length, 0)
  if (total === 0) return null

  return (
    <View style={[styles.box, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
      {...testProps('quiz-mistakes')}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>
            {t('mistakes.title')}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {t('mistakes.summary', { cards: total, decks: decks.length })}
          </Text>
        </View>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          {expanded ? t('mistakes.collapse') : t('mistakes.expand')}
        </Text>
      </Pressable>

      {expanded && decks.map((deck) => (
        <View key={deck.deckId} style={{ gap: 4 }}>
          <View style={styles.header}>
            <Text style={[theme.typography.caption, { color: theme.colors.text, flex: 1 }]}
              numberOfLines={1}>
              {deck.deckName}
            </Text>
            <Pressable
              disabled={starting}
              onPress={() => void studyDeck(deck.deckId, deck.items.map((m) => m.card_id as string))}
              {...testProps(`quiz-mistakes-study-${deck.deckId}`)}
            >
              <Text style={[theme.typography.caption,
                { color: theme.colors.primary, opacity: starting ? 0.4 : 1 }]}>
                {t('mistakes.studyAgain', { cards: deck.items.length })}
              </Text>
            </Pressable>
          </View>
          {deck.items.slice(0, 8).map((m) => {
            const mine = mistakeResponseText(m)
            return (
              <Text key={m.attempt_id}
                style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                <Text style={{ color: theme.colors.text }}>{m.stem}</Text>
                {/* Their own words beside the answer they were graded against: a list of stems
                    alone says only "you failed something here". */}
                {mine ? ` · ${t('mistakes.youWrote', { answer: mine })}` : ''}
                {m.reference_answer ? ` · ${t('run.reference', { answer: m.reference_answer })}` : ''}
              </Text>
            )
          })}
          {deck.items.length > 8 && (
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {t('mistakes.andMore', { cards: deck.items.length - 8 })}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
})
