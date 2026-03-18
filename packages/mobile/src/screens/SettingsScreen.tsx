import { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity, Switch, ScrollView, Alert, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, Divider } from '../components/ui'
import { testProps } from '../utils/testProps'
import { useAuth, useAuthState, usePurchases } from '../hooks'
import { useTheme } from '../theme'
import type { SettingsStackParamList } from '../navigation/types'
import { notificationService } from '../services/notifications'
import { getMobileSupabase } from '../adapters'
import type { SrsSettings } from '@reeeeecall/shared/types/database'
import { DEFAULT_SRS_SETTINGS } from '@reeeeecall/shared/types/database'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

const TTS_PROVIDERS = [
  { value: 'web_speech' as const, label: 'Web Speech' },
  { value: 'edge_tts' as const, label: 'Edge TTS' },
]

const AI_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'] },
  { id: 'google', label: 'Google Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] },
  { id: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'] },
  { id: 'xai', label: 'xAI (Grok)', models: ['grok-3-mini', 'grok-3'] },
]

interface ProfileData {
  display_name: string
  daily_new_limit: number
  tts_enabled: boolean
  tts_speed: number
  tts_provider: 'web_speech' | 'edge_tts'
  answer_mode: 'button' | 'swipe'
}

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'SettingsHome'>

export function SettingsScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { user } = useAuthState()
  const { signOut } = useAuth()
  const { isPro } = usePurchases()

  const [profile, setProfile] = useState<ProfileData>({
    display_name: '',
    daily_new_limit: 20,
    tts_enabled: false,
    tts_speed: 0.9,
    tts_provider: 'web_speech',
    answer_mode: 'button',
  })
  const [language, setLanguage] = useState('en')
  const [saving, setSaving] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)

  // SRS Settings (per-deck default)
  const [srsSettings, setSrsSettings] = useState<SrsSettings>(DEFAULT_SRS_SETTINGS)
  const [learningStepsText, setLearningStepsText] = useState(
    DEFAULT_SRS_SETTINGS.learning_steps?.join(', ') ?? '1, 10',
  )

  // AI Provider
  const [aiProvider, setAiProvider] = useState<string | null>(null)
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiEditingProvider, setAiEditingProvider] = useState<string | null>(null)

  // Load profile
  useEffect(() => {
    if (!user) return
    const supabase = getMobileSupabase()
    supabase
      .from('profiles')
      .select('display_name, daily_new_limit, tts_enabled, tts_speed, tts_provider, answer_mode')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile({
            display_name: data.display_name ?? '',
            daily_new_limit: data.daily_new_limit ?? 20,
            tts_enabled: data.tts_enabled ?? false,
            tts_speed: data.tts_speed ?? 0.9,
            tts_provider: data.tts_provider ?? 'web_speech',
            answer_mode: data.answer_mode ?? 'button',
          })
        }
      })
  }, [user])

  // Load notification status
  useEffect(() => {
    notificationService.init()
    notificationService.isEnabled().then(setNotificationsEnabled)
  }, [])

  const toggleNotifications = async (enabled: boolean) => {
    if (enabled) {
      const granted = await notificationService.requestPermission()
      if (granted) {
        await notificationService.scheduleDailyReminder(9, 0)
        setNotificationsEnabled(true)
      } else {
        Alert.alert('Permission Required', 'Enable notifications in device settings.')
      }
    } else {
      await notificationService.cancelDailyReminder()
      setNotificationsEnabled(false)
    }
  }

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

  const handleSaveLearningSteps = () => {
    const steps = learningStepsText
      .split(',')
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n) && n > 0)
    if (steps.length > 0) {
      setSrsSettings((prev) => ({ ...prev, learning_steps: steps }))
    }
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

        {/* SRS Configuration */}
        <SettingsSection title="SRS Configuration" theme={theme}>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            Default SRS settings for new decks. Each deck can override these.
          </Text>

          <TextInput
            testID="settings-srs-learning-steps"
            label="Learning Steps (minutes, comma-separated)"
            value={learningStepsText}
            onChangeText={setLearningStepsText}
            onBlur={handleSaveLearningSteps}
            placeholder="1, 10"
          />

          <View style={styles.srsRow}>
            <View style={styles.srsField}>
              <TextInput
                testID="settings-srs-good-interval"
                label="Good Interval (days)"
                value={String(srsSettings.good_days)}
                onChangeText={(v) => setSrsSettings((p) => ({ ...p, good_days: parseInt(v) || 1 }))}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.srsField}>
              <TextInput
                testID="settings-srs-easy-interval"
                label="Easy Interval (days)"
                value={String(srsSettings.easy_days)}
                onChangeText={(v) => setSrsSettings((p) => ({ ...p, easy_days: parseInt(v) || 4 }))}
                keyboardType="number-pad"
              />
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
            <>
              {/* TTS Provider */}
              <View style={styles.settingRow}>
                <Text style={[theme.typography.body, { color: theme.colors.text }]}>Provider</Text>
                <View style={styles.chipRow}>
                  {TTS_PROVIDERS.map((prov) => (
                    <TouchableOpacity
                      key={prov.value}
                      testID={`settings-tts-provider-${prov.value}`}
                      onPress={() => saveProfile({ tts_provider: prov.value })}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: profile.tts_provider === prov.value ? theme.colors.primaryLight : theme.colors.surface,
                          borderColor: profile.tts_provider === prov.value ? theme.colors.primary : theme.colors.border,
                        },
                      ]}
                    >
                      <Text style={[
                        theme.typography.bodySmall,
                        { color: profile.tts_provider === prov.value ? theme.colors.primary : theme.colors.text },
                      ]}>
                        {prov.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* TTS Speed */}
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
            </>
          )}
        </SettingsSection>

        <Divider />

        {/* AI Providers */}
        <SettingsSection title="AI Providers" theme={theme}>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            Configure AI providers for card generation. Keys are encrypted locally.
          </Text>
          {AI_PROVIDERS.map((provider) => {
            const isEditing = aiEditingProvider === provider.id
            return (
              <View key={provider.id} style={[styles.aiProviderCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={styles.aiProviderHeader}>
                  <Text style={[theme.typography.label, { color: theme.colors.text }]}>{provider.label}</Text>
                  <TouchableOpacity
                    onPress={() => setAiEditingProvider(isEditing ? null : provider.id)}
                    testID={`settings-ai-${provider.id}-toggle`}
                  >
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                      {isEditing ? 'Cancel' : 'Configure'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {isEditing && (
                  <View style={styles.aiEditForm}>
                    <TextInput
                      testID={`settings-ai-${provider.id}-key`}
                      label="API Key"
                      value={aiApiKey}
                      onChangeText={setAiApiKey}
                      secureTextEntry
                      placeholder="Enter your API key..."
                    />
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                      Models: {provider.models.join(', ')}
                    </Text>
                    <Button
                      title="Save"
                      size="sm"
                      onPress={() => {
                        // Save logic would use AIKeyVault
                        setAiEditingProvider(null)
                        setAiApiKey('')
                      }}
                      testID={`settings-ai-${provider.id}-save`}
                    />
                  </View>
                )}
              </View>
            )
          })}
        </SettingsSection>

        <Divider />

        {/* Notifications */}
        <SettingsSection title="Notifications" theme={theme}>
          <View style={styles.settingRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Daily Study Reminder</Text>
            <Switch
              testID="settings-notification-toggle"
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          {notificationsEnabled && (
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              You'll be reminded daily at 9:00 AM to review your cards.
            </Text>
          )}
        </SettingsSection>

        <Divider />

        {/* Subscription */}
        <SettingsSection title="Subscription" theme={theme}>
          <View style={[styles.subCard, { backgroundColor: isPro ? theme.colors.successLight : theme.colors.surface, borderColor: isPro ? theme.colors.success : theme.colors.border }]}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>
              {isPro ? '👑 Pro' : 'Free Plan'}
            </Text>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
              {isPro ? 'All premium features unlocked' : 'Upgrade for unlimited access'}
            </Text>
          </View>
          {!isPro && (
            <Button
              testID="settings-upgrade"
              title="Upgrade to Pro"
              onPress={() => navigation.navigate('Paywall')}
            />
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
  subCard: { padding: 16, borderRadius: 12, borderWidth: 1.5, gap: 4 },
  srsRow: { flexDirection: 'row', gap: 12 },
  srsField: { flex: 1 },
  aiProviderCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  aiProviderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiEditForm: { gap: 10 },
})
