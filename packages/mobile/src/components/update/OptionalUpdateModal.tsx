import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'
import { useAppUpdateStore } from '../../services/app-update'

/**
 * Dismissable nudge shown when a newer (but non-mandatory) version exists —
 * i.e. the gate returned 'optional'. "Later" hides it for the session; it never
 * appears for a hard block (that path renders ForceUpdateScreen instead).
 */
export function OptionalUpdateModal() {
  const theme = useTheme()
  const { t } = useTranslation('update')
  const status = useAppUpdateStore((s) => s.status)
  const dismissed = useAppUpdateStore((s) => s.optionalDismissed)
  const openStore = useAppUpdateStore((s) => s.openStore)
  const dismissOptional = useAppUpdateStore((s) => s.dismissOptional)

  const visible = status === 'optional' && !dismissed

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissOptional}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]} {...testProps('optional-update-modal', true)}>
          <Text style={styles.icon}>✨</Text>
          <Text style={[styles.title, { color: theme.colors.text }]}>{t('optionalTitle')}</Text>
          <Text style={[styles.message, { color: theme.colors.textSecondary }]}>{t('optionalMessage')}</Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => { openStore(); dismissOptional() }}
            activeOpacity={0.85}
            {...testProps('optional-update-button')}
          >
            <Text style={styles.primaryBtnText}>{t('updateButton')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.laterBtn} onPress={dismissOptional} activeOpacity={0.7} {...testProps('optional-update-later')}>
            <Text style={[styles.laterText, { color: theme.colors.textSecondary }]}>{t('laterButton')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 24, borderWidth: 1, padding: 24, alignItems: 'center' },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 22 },
  primaryBtn: { width: '100%', paddingVertical: 15, borderRadius: 16, alignItems: 'center', marginBottom: 8 },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  laterBtn: { width: '100%', paddingVertical: 12, alignItems: 'center' },
  laterText: { fontSize: 14, fontWeight: '500' },
})
