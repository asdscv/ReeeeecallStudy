import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useQuizStore, mistakeResponseText, groupMistakesByDeck } from '@reeeeecall/shared/stores/quiz-store'
import { dateLine } from '@reeeeecall/shared/lib/quiz-outcome'
import { Screen, ScreenHeader, EmptyState } from '../../components/ui'
import { useStudy } from '../../hooks/useStudy'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'

/**
 * 오답 노트, on its own screen, one deck at a time.
 *
 * It began as a panel that expanded on the quiz home and ran out of room immediately: five decks
 * of misses is a wall of text above the sets the learner came for. The panel stays as a summary —
 * how many cards, how many decks — and the reading happens here.
 *
 * A deck is picked, not merged. Cards from two decks cannot be one study session, so "study these
 * again" is per deck anyway, and mixing 영어 회화 with 중국어 발음 makes neither readable.
 *
 * One row per card, newest miss first. Choosing to restudy them IS an SRS session, so that
 * decision moves the schedule — which is exactly why the app does not make it on its own.
 */
export function QuizMistakesScreen() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation()
  const { mistakes, loadMistakes, loading } = useQuizStore()
  const { startCardSession } = useStudy()
  const [deckId, setDeckId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => { void loadMistakes(undefined, 200).catch(() => {}) }, [loadMistakes])

  const decks = useMemo(() => groupMistakesByDeck(mistakes), [mistakes])
  // The deck with the most misses opens first: it is the one there is most to do about.
  const active = decks.find((d) => d.deckId === deckId)
    ?? [...decks].sort((a, b) => b.items.length - a.items.length)[0]
  const total = decks.reduce((n, d) => n + d.items.length, 0)

  const study = useCallback(async () => {
    if (!active) return
    setStarting(true)
    try {
      await startCardSession(active.deckId, active.items.map((m) => m.card_id as string))
      // Cross-stack, the shape the diagnostics panel uses: `StudySession` lives in the Study
      // tab's stack while quiz lives in its own.
      const tabNav = navigation.getParent() as unknown as
        { navigate: (name: string, params?: unknown) => void } | undefined
      tabNav?.navigate('StudyTab', { screen: 'StudySession' })
    } catch {
      // Leaving the list on screen is the honest failure: nothing was lost.
    } finally { setStarting(false) }
  }, [active, startCardSession, navigation])

  const caption = { ...theme.typography.caption, color: theme.colors.textSecondary }

  return (
    <Screen>
      <ScreenHeader title={t('mistakes.title')} mode="back" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} {...testProps('quiz-mistakes-page')}>
        {decks.length === 0 ? (
          loading
            ? <Text style={caption}>{t('run.loading')}</Text>
            // Not an error and not a shrug: someone who has never got one wrong should be told
            // that is what happened.
            : <EmptyState title={t('mistakes.emptyTitle')} description={t('mistakes.emptyBody')} />
        ) : (
          <>
            <Text style={caption}>
              {t('mistakes.summary', { cards: total, decks: decks.length })}
            </Text>

            {decks.length > 1 && (
              // Deck chips rather than one merged list: a session cannot span two decks, so the
              // list that feeds it should not either.
              <View style={styles.chips}>
                {decks.map((deck) => {
                  const on = active?.deckId === deck.deckId
                  return (
                    <Pressable
                      key={deck.deckId}
                      onPress={() => setDeckId(deck.deckId)}
                      style={[styles.chip, {
                        borderColor: on ? theme.colors.primary : theme.colors.border,
                        backgroundColor: on ? theme.colors.primary + '1A' : 'transparent',
                      }]}
                      {...testProps(`quiz-mistakes-deck-${deck.deckId}`)}
                    >
                      <Text style={[theme.typography.caption, {
                        color: on ? theme.colors.primary : theme.colors.textSecondary,
                      }]}>
                        {deck.deckName} {deck.items.length}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            )}

            {active && (
              <>
                <View style={styles.header}>
                  <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]}
                    numberOfLines={1}>
                    {active.deckName}
                  </Text>
                  <Pressable disabled={starting} onPress={() => void study()}
                    {...testProps('quiz-mistakes-study')}>
                    <Text style={[theme.typography.caption, {
                      color: theme.colors.primary, opacity: starting ? 0.4 : 1,
                    }]}>
                      {t('mistakes.studyAgain', { cards: active.items.length })}
                    </Text>
                  </Pressable>
                </View>

                {active.items.map((m) => {
                  const mine = mistakeResponseText(m)
                  const at = dateLine(m.answered_at)
                  return (
                    <View key={m.attempt_id} style={[styles.card, {
                      backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border,
                    }]}>
                      <View style={styles.header}>
                        <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>
                          {m.stem}
                        </Text>
                        {at && <Text style={caption}>{t(at.key, at.params)}</Text>}
                      </View>
                      {/* Their own words beside the answer they were graded against. Not clamped
                          here — there is room, and this is the screen a learner comes to in
                          order to read them. */}
                      {mine && <Text style={caption}>{t('mistakes.youWrote', { answer: mine })}</Text>}
                      {m.reference_answer && (
                        <Text style={caption}>{t('run.reference', { answer: m.reference_answer })}</Text>
                      )}
                    </View>
                  )
                })}
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 32 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 3 },
})
