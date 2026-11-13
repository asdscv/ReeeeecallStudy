import { useState } from 'react'
import { View, Text, Pressable, Switch, Modal, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { TIMING_MODES, type BrainSettings, type TimingMode } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Button } from '../ui'
import { useTheme, type Theme } from '../../theme'
import { areHapticsEnabled, haptics, setHapticsEnabled } from '../../utils/haptics'
import { localPrefs } from '../../utils/local-prefs'

const TIMING_LABEL: Record<TimingMode, string> = {
  1: 'settings.timing_1',
  1.5: 'settings.timing_1_5',
  2: 'settings.timing_2',
  0: 'settings.timing_0',
}

/**
 * Relaxed timing — an older player's slower reactions should not read as failing the game — and
 * vibration. The web has a game-sound switch here; the phone's games speak through haptics, so its
 * switch is the app-wide vibration setting itself (the same one Settings shows).
 */
export function BrainSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const settings = useBrainStore((s) => s.progress.settings)
  const set = (patch: Partial<BrainSettings>) => {
    haptics.selection()
    useBrainStore.getState().setSettings(patch)
  }
  const [hapticsOn, setHapticsOn] = useState(areHapticsEnabled)
  const setVibration = (on: boolean) => {
    setHapticsOn(on)
    setHapticsEnabled(on)
    localPrefs.setHapticsEnabled(on)
    if (on) haptics.success() // felt at once, so the player knows it is on
  }

  return (
    // Re-read on open: the same setting can change in the app's Settings while this stays mounted.
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => setHapticsOn(areHapticsEnabled())}>
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

            <SwitchRow
              label={t('settings.haptics')}
              help={t('settings.hapticsHelp')}
              value={hapticsOn}
              onChange={setVibration}
              theme={theme}
              testID="brain-haptics"
            />

            <Button title={t('settings.close')} onPress={onClose} size="lg" testID="brain-settings-close" />
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  )
}

/**
 * A whole-row switch: the row is the control (role switch, one big target, one announcement), the
 * Switch inside is its picture.
 */
function SwitchRow({ label, help, value, onChange, theme, testID }: { label: string; help: string; value: boolean; onChange: (v: boolean) => void; theme: Theme; testID: string }) {
  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => onChange(!value)}
        style={styles.switchRow}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={help}
        accessibilityState={{ checked: value }}
        testID={testID}
      >
        <Text style={[styles.label, styles.switchLabel, { color: theme.colors.text }]}>{label}</Text>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: theme.colors.primary }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </Pressable>
      <Text style={[styles.help, { color: theme.colors.textSecondary }]}>{help}</Text>
    </View>
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
})
