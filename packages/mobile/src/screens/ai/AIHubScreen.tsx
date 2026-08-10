import { useCallback, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { aiHubEntries } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { aiHubBus } from '@reeeeecall/shared/lib/ai/hub/events'
import { isAiBadgeEligible, type AiHubEntry } from '@reeeeecall/shared/lib/ai/hub/types'
import { Screen, ScreenHeader } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'

/**
 * The three AI surfaces, in one place.
 *
 * Nothing here names a feature: the tiles are `aiHubEntries()`, so registering a fourth in
 * `packages/shared/lib/ai/hub/catalog.ts` puts it on this screen and in the drawer at once.
 * The badge is likewise derived — 학습 플랜 is device-side SM-2 scheduling and must never be
 * sold as model output, which is what `isAiBadgeEligible` enforces.
 */
export function AIHubScreen() {
  const theme = useTheme()
  const { t } = useTranslation('ai-generate')
  // Untyped on purpose: the drawer's param list declares each stack as `undefined`, so the
  // nested `{ screen }` form has no typed spelling here. Same escape hatch as every other
  // cross-stack jump in this app (DecksListScreen, DashboardScreen).
  const navigation = useNavigation()
  const entries = aiHubEntries()

  useEffect(() => {
    aiHubBus.emit({ type: 'ai_hub.opened', source: 'nav' })
  }, [])

  const open = useCallback((entry: AiHubEntry) => {
    aiHubBus.emit({ type: 'ai_hub.entry_opened', entryId: entry.id, source: 'hub' })
    const drawer = navigation.getParent()
    if (drawer) drawer.navigate(entry.mobileStack, { screen: entry.mobileScreen })
  }, [navigation])

  return (
    <Screen safeArea padding={false} testID="ai-hub-screen">
      {/* AIHub is the AITab landing, so there is no pushed screen to pop. The drawer control is
          the way out, matching QuizHomeScreen and every other stack root. */}
      <ScreenHeader title={t('hub.title')} mode="drawer" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[theme.typography.bodySmall, styles.subtitle, { color: theme.colors.textSecondary }]}>
          {t('hub.subtitle')}
        </Text>

        {entries.map((entry) => (
          <Pressable
            key={entry.id}
            onPress={() => open(entry)}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            accessibilityRole="button"
            // testProps overwrites the label with the testID on Android, so the hint is the only
            // place a screen reader learns what the chevron does.
            accessibilityHint={t('hub.openAction')}
            {...testProps(`ai-hub-entry-${entry.id}`)}
          >
            <Text style={styles.icon}>{entry.icon}</Text>
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={[theme.typography.label, styles.title, { color: theme.colors.text }]}>
                  {t(entry.titleKey)}
                </Text>
                {isAiBadgeEligible(entry) && (
                  <View style={[styles.badge, { backgroundColor: theme.colors.primaryLight }]}>
                    <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                      {t('hub.badge.ai')}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {t(entry.descKey)}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: theme.colors.textTertiary }]}>{'›'}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  subtitle: { paddingTop: 12, paddingBottom: 4 },
  // 'flex-start', not 'center': a centered row sizes to the tallest child and clips the two-line
  // Korean descriptions instead of letting them wrap. Same bug PR #294 fixed on the study card.
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { fontSize: 24, lineHeight: 30 },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { flexShrink: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  chevron: { fontSize: 22, lineHeight: 28 },
})
