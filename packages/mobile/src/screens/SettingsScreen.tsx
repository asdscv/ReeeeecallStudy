import { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity, Switch, ScrollView, Alert, StyleSheet } from 'react-native'
import { Screen, TextInput, Button, Divider } from '../components/ui'
import { useAuth, useAuthState } from '../hooks'
import { useTheme } from '../theme'
import { getMobileSupabase } from '../adapters'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

interface ProfileData {
  display_name: string
  daily_new_limit: number
  tts_enabled: boolean
  tts_speed: number
  answer_mode: 'button' | 'swipe'
}

export function SettingsScreen() {
  const theme = useTheme()
  const { user } = useAuthState()
  const { signOut } = useAuth()

  const [profile, setProfile] = useState<ProfileData>({
    display_name: '',
    daily_new_limit: 20,
    tts_enabled: false,
    tts_speed: 0.9,
    answer_mode: 'button',
  })
  const [language, setLanguage] = useState('en')
  const [saving, setSaving] = useState(false)

  // Load profile
  useEffect(() => {
    if (!user) return
    const supabase = getMobileSupabase()
    supabase
      .from('profiles')
      .select('display_name, daily_new_limit, tts_enabled, tts_speed, answer_mode')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile({
            display_name: data.display_name ?? '',
            daily_new_limit: data.daily_new_limit ?? 20,
            tts_enabled: data.tts_enabled ?? false,
            tts_speed: data.tts_speed ?? 0.9,
            answer_mode: data.answer_mode ?? 'button',
          })
        }
      })
  }, [user])

  const saveProfile = useCallback(async (updates: Partial<ProfileData>) => {
    if (!user) return
    setSaving(true)
    const supabase = getMobileSupabase()
    await supabase.from('profiles').update(updates).eq('id', user.id)
    setProfile((prev) => ({ ...prev, ...updates }))
    setSaving(false)
  }, [user])

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: signOut },
    ])
  }

  return (
    <Screen safeArea padding={false} testID="settings-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[theme.typography.h1, styles.title, { color: theme.colors.text }]}>Settings</Text>

        {/* Profile */}
        <SettingsSection title="Profile" theme={theme}>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            {user?.email}
          </Text>
          <TextInput
            testID="settings-display-name"
            label="Display Name"
            value={profile.display_name}
            onChangeText={(v) => setProfile((p) => ({ ...p, display_name: v }))}
            onBlur={() => saveProfile({ display_name: profile.display_name })}
          />
        </SettingsSection>

        <Divider />

        {/* Language */}
        <SettingsSection title="Language" theme={theme}>
          <View style={styles.chipRow}>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                testID={`settings-lang-${lang.code}`}
                onPress={() => setLanguage(lang.code)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: language === lang.code ? theme.colors.primaryLight : theme.colors.surface,
                    borderColor: language === lang.code ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text style={[
                  theme.typography.bodySmall,
                  { color: language === lang.code ? theme.colors.primary : theme.colors.text },
                ]}>
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SettingsSection>

        <Divider />

        {/* Study Settings */}
        <SettingsSection title="Study" theme={theme}>
          <TextInput
            testID="settings-daily-limit"
            label="Daily New Card Limit"
            value={String(profile.daily_new_limit)}
            onChangeText={(v) => {
              const num = parseInt(v) || 0
              setProfile((p) => ({ ...p, daily_new_limit: num }))
            }}
            onBlur={() => saveProfile({ daily_new_limit: profile.daily_new_limit })}
            keyboardType="number-pad"
          />

          <View style={styles.settingRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Answer Mode</Text>
            <View style={styles.chipRow}>
              {(['button', 'swipe'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  testID={`settings-answer-${mode}`}
                  onPress={() => saveProfile({ answer_mode: mode })}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: profile.answer_mode === mode ? theme.colors.primaryLight : theme.colors.surface,
                      borderColor: profile.answer_mode === mode ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[
                    theme.typography.bodySmall,
                    { color: profile.answer_mode === mode ? theme.colors.primary : theme.colors.text },
                  ]}>
                    {mode === 'button' ? '🔘 Button' : '👆 Swipe'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </SettingsSection>

        <Divider />

        {/* TTS */}
        <SettingsSection title="Text-to-Speech" theme={theme}>
          <View style={styles.settingRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Enable TTS</Text>
            <Switch
              testID="settings-tts-toggle"
              value={profile.tts_enabled}
              onValueChange={(v) => saveProfile({ tts_enabled: v })}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          {profile.tts_enabled && (
            <View style={styles.settingRow}>
              <Text style={[theme.typography.body, { color: theme.colors.text }]}>
                Speed: {profile.tts_speed}x
              </Text>
              <View style={styles.chipRow}>
                {[0.5, 0.75, 0.9, 1.0, 1.25, 1.5].map((speed) => (
                  <TouchableOpacity
                    key={speed}
                    testID={`settings-tts-speed-${speed}`}
                    onPress={() => saveProfile({ tts_speed: speed })}
                    style={[
                      styles.speedChip,
                      {
                        backgroundColor: profile.tts_speed === speed ? theme.colors.primary : theme.colors.surface,
                        borderColor: profile.tts_speed === speed ? theme.colors.primary : theme.colors.border,
                      },
                    ]}
                  >
                    <Text style={[
                      theme.typography.caption,
                      { color: profile.tts_speed === speed ? theme.colors.primaryText : theme.colors.text },
                    ]}>
                      {speed}x
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </SettingsSection>

        <Divider />

        {/* Account */}
        <SettingsSection title="Account" theme={theme}>
          <Button
            testID="settings-logout"
            title="Logout"
            variant="danger"
            onPress={handleLogout}
          />
        </SettingsSection>
      </ScrollView>
    </Screen>
  )
}

function SettingsSection({ title, children, theme }: {
  title: string; children: React.ReactNode; theme: ReturnType<typeof useTheme>
}) {
  return (
    <View style={styles.section}>
      <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  title: { paddingTop: 16, paddingBottom: 8 },
  section: { gap: 12, paddingVertical: 16 },
  sectionContent: { gap: 12 },
  settingRow: { gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  speedChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
})
