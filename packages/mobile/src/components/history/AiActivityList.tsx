import { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useQuizStore, isDailyCheckTitle, type AiActivityEntry } from '@reeeeecall/shared/stores/quiz-store'
import { dateLine, tallyFromCounts, tallyLine } from '@reeeeecall/shared/lib/quiz-outcome'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'

/**
 * What the learner did through AI, on the screen that answers "what have I been doing".
 *
 * 기록 read study sessions and nothing else, so an afternoon of generating a deck, sitting three
 * quizzes and paying for six gradings showed as an empty day.
 *
 * The tally is phrased by `tallyLine`, the same function the run and result screens use, so a
 * sitting cannot read one way here and another there.
 */
export function AiActivityList({ limit = 30 }: { limit?: number }) {
  const { t } = useTranslation('quiz')
  const theme = useTheme()
  const { loadAiActivity } = useQuizStore()
  const [entries, setEntries] = useState<AiActivityEntry[] | null>(null)

  useEffect(() => {
    let live = true
    void loadAiActivity(limit)
      .then((rows) => { if (live) setEntries(rows) })
      .catch(() => { if (live) setEntries([]) })
    return () => { live = false }
  }, [loadAiActivity, limit])

  // Nothing yet, or nothing ever: a learner who has never used AI should not be handed an empty
  // box about it.
  if (!entries || entries.length === 0) return null

  const caption = { ...theme.typography.caption, color: theme.colors.textSecondary }

  return (
    <View style={styles.wrap} {...testProps('ai-activity')}>
      <Text style={[theme.typography.label, { color: theme.colors.text }]}>
        {t('activity.title')}
      </Text>
      {entries.map((e) => {
        const at = dateLine(e.at)
        const cost = e.price_micro > 0 ? formatUsdMicro(e.price_micro) : null
        return (
          <View key={`${e.kind}-${e.id}`} style={[styles.card, {
            backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border,
          }]}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                {e.kind === 'quiz' ? (
                  <>
                    <Text style={[theme.typography.body, { color: theme.colors.text }]}
                      numberOfLines={1}>
                      {t('activity.quiz', {
                        title: isDailyCheckTitle(e.title ?? '')
                          ? t('home.dailyCheckTitle') : e.title,
                        n: e.attempt_no ?? 1,
                      })}
                    </Text>
                    <Text style={caption}>
                      {(() => {
                        const line = tallyLine(tallyFromCounts(e.tally))
                        return t(line.key, line.params)
                      })()}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[theme.typography.body, { color: theme.colors.text }]}
                      numberOfLines={1}>
                      {/* `quiz_action` is finer than `job_kind` for grading — "주관식 채점"
                          rather than "AI 퀴즈". */}
                      {t(`activity.job.${e.quiz_action ?? e.job_kind}`, {
                        defaultValue: t(`activity.job.${e.job_kind}`, { defaultValue: e.job_kind ?? '' }),
                      })}
                    </Text>
                    {(e.cards ?? 0) > 0 && (
                      <Text style={caption}>{t('home.questions', { count: e.cards })}</Text>
                    )}
                  </>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {at && <Text style={caption}>{t(at.key, at.params)}</Text>}
                {/* "무료" is information, not an absence. */}
                {e.kind === 'ai_gen' && (
                  <Text style={caption}>
                    {e.refunded ? t('activity.refunded') : (cost ?? t('activity.free'))}
                  </Text>
                )}
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
})
