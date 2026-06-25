import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'
import { useAppUpdateStore } from '../../services/app-update'

/**
 * Full-screen, non-dismissable gate shown when the installed binary is below
 * the backend's minimum supported version. The only available action is to open
 * the store and update — there is intentionally no "close" / "later".
 */
export function ForceUpdateScreen() {
  const theme = useTheme()
  const { t } = useTranslation('update')
  const openStore = useAppUpdateStore((s) => s.openStore)
  const serverMessage = useAppUpdateStore((s) => s.result?.requirement?.message)

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]} {...testProps('force-update-screen', true)}>
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
        <Text style={styles.icon}>🚀</Text>
        <Text style={[styles.title, { color: theme.colors.text }]}>{t('blockedTitle')}</Text>
        <Text style={[styles.message, { color: theme.colors.textSecondary }]}>
          {serverMessage || t('blockedMessage')}
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
          onPress={openStore}
          activeOpacity={0.85}
          {...testProps('force-update-button')}
        >
          <Text style={styles.primaryBtnText}>{t('updateButton')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 420, borderRadius: 24, borderWidth: 1, padding: 28, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6,
  },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 28 },
  primaryBtn: { width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
})
