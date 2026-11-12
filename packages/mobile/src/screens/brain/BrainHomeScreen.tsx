import { useEffect } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { BRAIN_GAMES, currentDays, displayLevel, gameProgress, localDayKey } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Screen, ScreenHeader } from '../../components/ui'
import { useAuthState } from '../../hooks'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'
import { brainStorageFor } from '../../components/brain/brain-ui'
import type { BrainStackParamList } from '../../navigation/types'

type Nav = NativeStackNavigationProp<BrainStackParamList, 'BrainHome'>
type FeatherName = React.ComponentProps<typeof Feather>['name']

/** The mixed run up top, every game below with the level it is at. */
export function BrainHomeScreen() {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const navigation = useNavigation<Nav>()
  const { user } = useAuthState()
  const hydrate = useBrainStore((s) => s.hydrate)
  const progress = useBrainStore((s) => s.progress)

  useEffect(() => {
    if (user) hydrate(brainStorageFor(user.id))
  }, [user, hydrate])

  const days = currentDays(progress, localDayKey())
  const chip = { backgroundColor: theme.colors.surface }

  return (
    <Screen padding={false}>
      <ScreenHeader title={t('title')} mode="drawer" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{t('subtitle')}</Text>

        {progress.totalRounds > 0 ? (
          <View style={styles.chips}>
            <Text style={[styles.chip, { backgroundColor: theme.isDark ? 'rgba(234,179,8,0.15)' : '#fef9c3', color: theme.isDark ? '#facc15' : '#a16207' }]}>
              🔥 {t('home.streak', { count: days.dayStreak })}
            </Text>
            <Text style={[styles.chip, chip, { color: theme.colors.textSecondary }]}>
              {t('home.today', { value: formatCount(days.todayRounds) })}
            </Text>
            <Text style={[styles.chip, chip, { color: theme.colors.textSecondary }]}>
              {t('home.totalPoints', { value: formatCount(progress.totalPoints) })}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => navigation.navigate('BrainPlay', { mode: 'mix' })}
          style={({ pressed }) => [styles.mix, { backgroundColor: pressed ? theme.colors.buttonPrimaryPressed : theme.colors.primary }]}
          {...testProps('brain-mix')}
        >
          <View style={styles.mixIcon}>
            <Feather name="shuffle" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{t('mix.title')}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>{t('mix.desc')}</Text>
          </View>
          <View style={styles.mixStart}>
            <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 13 }}>▶ {t('mix.start')}</Text>
          </View>
        </Pressable>

        <Text style={{ color: theme.colors.textTertiary, fontSize: 12, fontWeight: '600' }}>{t('home.games')}</Text>
        <View style={{ gap: 8 }}>
          {BRAIN_GAMES.map((game) => {
            const p = gameProgress(progress, game.id)
            return (
              <Pressable
                key={game.id}
                onPress={() => navigation.navigate('BrainPlay', { mode: game.id })}
                style={({ pressed }) => [
                  styles.game,
                  { backgroundColor: theme.colors.surfaceElevated, borderColor: pressed ? theme.colors.primary : theme.colors.border },
                ]}
                {...testProps(`brain-game-${game.id}`)}
              >
                <View style={[styles.gameIcon, { backgroundColor: theme.colors.primaryLight }]}>
                  <Feather name={game.icon as FeatherName} size={20} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.gameTop}>
                    <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
                      {t(`games.${game.id}.name`)}
                    </Text>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>
                      {p.rounds > 0 ? t('home.level', { level: displayLevel(p.level) }) : t('home.new')}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{t(`games.${game.id}.desc`)}</Text>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                    {t(`skills.${game.skill}`)}
                    {p.rounds > 0 ? ` · ${t('home.best', { level: displayLevel(p.bestLevel) })}` : ''}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>

        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{t('home.howItWorks')}</Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>{t('note')}</Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  mix: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14 },
  mixIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  mixStart: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  game: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  gameIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  gameTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
})
