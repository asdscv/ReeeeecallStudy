import { View, Text, Pressable, Switch, Modal, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { TIMING_MODES, type BrainSettings, type TimingMode } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Button } from '../ui'
import { useTheme } from '../../theme'
import { haptics } from '../../utils/haptics'

const TIMING_LABEL: Record<TimingMode, string> = {
  1: 'settings.timing_1',
  1.5: 'settings.timing_1_5',
  2: 'settings.timing_2',
  0: 'settings.timing_0',
}

/**
 * Relaxed timing and Quick Eye's centre-only mode. Both exist for the same reason: an older
 * player's slower reactions or a narrower visual field should not read as failing the game.
 */
export function BrainSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const settings = useBrainStore((s) => s.progress.settings)
  const set = (patch: Partial<BrainSettings>) => {
    haptics.selection()
    useBrainStore.getState().setSettings(patch)
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The backdrop closes the sheet but is not itself an accessibility element — it would
          swallow every control inside it (see SettingsScreen's language modal). */}
      <Pressable style={[styles.overlay, { backgroundColor: theme.colors.overlay }]} accessible={false} onPress={onClose}>
        <View
          // Claims the responder so a tap on the sheet's own text does not reach the backdrop.
          onStartShouldSetResponder={() => true}
          style={[styles.sheet, { backgroundColor: theme.colors.surfaceElevated }]}
        >
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={[styles.title, { color: theme.colors.text }]} accessibilityRole="header">
              {t('settings.title')}
            </Text>

            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.colors.text }]}>{t('settings.timing')}</Text>
              <View style={[styles.segments, { backgroundColor: theme.colors.surface }]} accessibilityRole="radiogroup">
                {TIMING_MODES.map((mode) => {
                  const active = settings.timing === mode
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => set({ timing: mode })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, checked: active }}
                      style={[
                        styles.segment,
                        active && { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.primary },
                      ]}
                      testID={`brain-timing-${mode}`}
                    >
                      <Text
                        style={[styles.segmentText, { color: active ? theme.colors.primary : theme.colors.textSecondary, fontWeight: active ? '700' : '500' }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {t(TIMING_LABEL[mode])}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              <Text style={[styles.help, { color: theme.colors.textSecondary }]}>{t('settings.timingHelp')}</Text>
            </View>

            <View style={styles.section}>
              <View style={styles.switchRow}>
                <Text style={[styles.label, styles.switchLabel, { color: theme.colors.text }]}>{t('settings.centerOnly')}</Text>
                <Switch
                  value={settings.centerOnly}
                  onValueChange={(v) => set({ centerOnly: v })}
                  trackColor={{ true: theme.colors.primary }}
                  accessibilityLabel={t('settings.centerOnly')}
                  testID="brain-center-only"
                />
              </View>
              <Text style={[styles.help, { color: theme.colors.textSecondary }]}>{t('settings.centerOnlyHelp')}</Text>
            </View>

            <Text style={[styles.help, styles.flash, { color: theme.colors.textSecondary, borderTopColor: theme.colors.border }]}>
              {t('settings.flash')}
            </Text>

            <Button title={t('settings.close')} onPress={onClose} size="lg" testID="brain-settings-close" />
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 20, maxHeight: '90%', width: '100%', maxWidth: 480, alignSelf: 'center', overflow: 'hidden' },
  content: { padding: 20, gap: 20 },
  title: { fontSize: 20, fontWeight: '700' },
  section: { gap: 10 },
  label: { fontSize: 17, fontWeight: '600' },
  segments: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentText: { fontSize: 16 },
  help: { fontSize: 15, lineHeight: 22 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  switchLabel: { flex: 1 },
  flash: { borderTopWidth: 1, paddingTop: 16 },
})
