import { useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { researchContent } from '@reeeeecall/shared/lib/brain-games'
import { Screen, ScreenHeader } from '../../components/ui'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

/**
 * The research basis — what the feature borrows from research, and what research does and does
 * not show. Korean and English only (see research-content.ts); in any other language the home
 * screen offers no link, and a stale deep link lands back there.
 */
export function BrainResearchScreen() {
  const theme = useTheme()
  const { i18n } = useTranslation('brain')
  const navigation = useNavigation()
  const content = researchContent(i18n.language)

  useEffect(() => {
    if (!content) navigation.goBack()
  }, [content, navigation])

  if (!content) return <Screen padding={false}>{null}</Screen>

  return (
    <Screen padding={false}>
      <ScreenHeader title={content.title} mode="back" />
      <ScrollView contentContainerStyle={styles.content} {...testProps('brain-research', true)}>
        {content.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={[styles.heading, { color: theme.colors.text }]} accessibilityRole="header">
              {section.heading}
            </Text>
            {section.paragraphs?.map((p, i) => (
              <Text key={i} style={[styles.body, { color: theme.colors.text }]}>
                {p}
              </Text>
            ))}
            {section.bullets ? (
              <View style={styles.bullets}>
                {section.bullets.map((b, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text style={[styles.body, styles.bulletMark, { color: theme.colors.textSecondary }]}>•</Text>
                    <Text style={[styles.body, styles.bulletText, { color: theme.colors.text }]}>{b}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <View style={[styles.section, styles.references, { borderTopColor: theme.colors.border }]}>
          {content.references.map((ref, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={[styles.refNumber, { color: theme.colors.textSecondary }]}>[{i + 1}]</Text>
              <Text style={[styles.ref, { color: theme.colors.textSecondary }]} selectable>
                {ref}
              </Text>
            </View>
          ))}
        </View>

        <Text style={[styles.disclaimer, { color: theme.colors.textSecondary }]}>{content.disclaimer}</Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 24 },
  section: { gap: 10 },
  heading: { fontSize: 19, fontWeight: '700', lineHeight: 26 },
  body: { fontSize: 16, lineHeight: 25 },
  bullets: { gap: 10 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bulletMark: { width: 12 },
  bulletText: { flex: 1 },
  references: { borderTopWidth: 1, paddingTop: 20 },
  refNumber: { fontSize: 15, lineHeight: 22, minWidth: 32, fontVariant: ['tabular-nums'] },
  ref: { flex: 1, fontSize: 15, lineHeight: 22 },
  disclaimer: { fontSize: 15, lineHeight: 22 },
})
