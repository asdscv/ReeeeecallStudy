import { useEffect, useMemo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { QuizStackParamList } from '../../navigation/types'
import { useTranslation } from 'react-i18next'
import { useQuizStore, groupMistakesByDeck } from '@reeeeecall/shared/stores/quiz-store'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'

/**
 * 오답 노트 — what you got wrong, and the one thing to do about it.
 *
 * Every wrong quiz answer was already being recorded: `answer_attempts` carries the card, the
 * response, the score and the run item, and nothing ever read it back. A learner could miss the
 * same card five sittings running and the app would never say so.
 *
 * This is the SUMMARY on the quiz home — how many cards, across how many decks — and it opens
 * `QuizMistakesScreen`, where the reading happens. It expanded in place at first and ran out of
 * room immediately: five decks of misses is a wall of text above the sets the learner came for.
 *
 * Renders nothing at zero, deliberately: someone who has never got one wrong should not be shown
 * an empty 오답 노트 on every visit.
 */
export function QuizMistakes() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation<NativeStackNavigationProp<QuizStackParamList>>()
  const { mistakes, loadMistakes } = useQuizStore()

  useEffect(() => { void loadMistakes(undefined, 200).catch(() => {}) }, [loadMistakes])

  // Shared with the other platform and with the screen itself: three copies of "which card,
  // which deck, how many times" is three places for them to start disagreeing.
  const decks = useMemo(() => groupMistakesByDeck(mistakes), [mistakes])
  const total = decks.reduce((n, d) => n + d.items.length, 0)
  if (total === 0) return null

  return (
    // A SUMMARY that opens the screen, not the list itself. Expanding five decks of misses in
    // place buried the sets the learner came to this screen for.
    <Pressable
      onPress={() => navigation.navigate('QuizMistakes')}
      style={[styles.box, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
      {...testProps('quiz-mistakes')}
    >
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.label, { color: theme.colors.text }]}>
          {t('mistakes.title')}
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
          {t('mistakes.summary', { cards: total, decks: decks.length })}
        </Text>
      </View>
      <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
        {t('mistakes.open')}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
})
