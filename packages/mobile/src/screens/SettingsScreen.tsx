import { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity, Switch, ScrollView, Alert, StyleSheet, Linking, Modal, FlatList } from 'react-native'
import Slider from '@react-native-community/slider'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { Screen, TextInput, Button, DrawerHeader } from '../components/ui'
import { useAuth, useAuthState, usePurchases } from '../hooks'
import { useTheme, palette } from '../theme'
import type { SettingsStackParamList } from '../navigation/types'
import { notificationService } from '../services/notifications'
import { getMobileSupabase } from '../adapters'
import type { SrsSettings } from '@reeeeecall/shared/types/database'
import { DEFAULT_SRS_SETTINGS } from '@reeeeecall/shared/types/database'

const PRIVACY_POLICY_URL = 'https://reeeeecall.com/privacy'
const TERMS_OF_SERVICE_URL = 'https://reeeeecall.com/terms'
const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const APP_VERSION = '1.0.0'

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'vi', label: 'Tieng Viet', flag: '🇻🇳' },
  { code: 'th', label: 'Thai', flag: '🇹🇭' },
  { code: 'id', label: 'Bahasa', flag: '🇮🇩' },
]

const TTS_PROVIDERS = [
  { value: 'web_speech' as const, label: 'Device Voice', desc: "Uses your device's built-in voice", noteKey: '' },
  { value: 'edge_tts' as const, label: 'Edge TTS', desc: 'Higher quality neural voice', noteKey: 'tts.edgeTtsNote' },
]

const AI_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', color: palette.green[600], bg: '#F0FDF4', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'] },
  { id: 'google', label: 'Google Gemini', color: palette.blue[600], bg: palette.blue[50], models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] },
  { id: 'anthropic', label: 'Anthropic', color: '#C2410C', bg: '#FFF7ED', models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'] },
  { id: 'xai', label: 'xAI (Grok)', color: palette.gray[900], bg: palette.gray[100], models: ['grok-3-mini', 'grok-3'] },
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
  const { t, i18n } = useTranslation('settings')
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
  const [language, setLanguage] = useState(i18n.language || 'en')
  const [langDropdownOpen, setLangDropdownOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [aiCollapsed, setAiCollapsed] = useState(true)

  // SRS Settings (per-deck default)
  const [srsSettings, setSrsSettings] = useState<SrsSettings>(DEFAULT_SRS_SETTINGS)
  const [learningStepsText, setLearningStepsText] = useState(
    DEFAULT_SRS_SETTINGS.learning_steps?.join(', ') ?? '1, 10',
  )

  // AI Provider
  const [aiEditingProvider, setAiEditingProvider] = useState<string | null>(null)
  const [aiApiKey, setAiApiKey] = useState('')

  // Load profile
  useEffect(() => {
    if (!user) return
    const supabase = getMobileSupabase()
    supabase
      .from('profiles')
      .select('display_name, daily_new_limit, tts_enabled, tts_speed, tts_provider, answer_mode, language')
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
          if (data.language) {
            setLanguage(data.language)
            i18n.changeLanguage(data.language)
          }
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

  const handleLanguageChange = useCallback(async (code: string) => {
    setLanguage(code)
    i18n.changeLanguage(code)
    if (!user) return
    const supabase = getMobileSupabase()
    await supabase.from('profiles').update({ language: code }).eq('id', user.id)
  }, [user, i18n])

  const handleLogout = () => {
    Alert.alert(t('account.logout'), t('account.logoutConfirm'), [
      { text: t('actions.cancel', { ns: 'common' }), style: 'cancel' },
      { text: t('account.logout'), style: 'destructive', onPress: signOut },
    ])
  }

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              const supabase = getMobileSupabase()
              const { error } = await supabase.rpc('delete_user_account')
              if (error) {
                Alert.alert('Error', 'Failed to delete account. Please contact support.')
                return
              }
              await signOut()
            } catch {
              Alert.alert('Error', 'Failed to delete account. Please contact support.')
            }
          },
        },
      ],
    )
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

  // Get user initials for avatar
  const userInitial = (profile.display_name || user?.email || '?')[0].toUpperCase()

  return (
    <Screen safeArea padding={false} testID="settings-screen">
      <DrawerHeader title={t('title')} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── a) Profile Section ── */}
        <SectionCard theme={theme}>
          <View style={styles.profileRow}>
            <View style={[styles.avatarCircle, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.avatarText}>{userInitial}</Text>
            </View>
            <View style={styles.profileInfo}>
              <TextInput
                testID="settings-display-name"
                label="Display Name"
                value={profile.display_name}
                onChangeText={(v) => setProfile((p) => ({ ...p, display_name: v }))}
                onBlur={() => saveProfile({ display_name: profile.display_name })}
                placeholder="2-12 characters"
              />
              <Text style={[styles.emailText, { color: theme.colors.textSecondary }]}>{user?.email}</Text>
              <View style={[styles.planBadge, {
                backgroundColor: isPro ? theme.colors.successLight : palette.gray[100],
                borderColor: isPro ? theme.colors.success : palette.gray[300],
              }]}>
                <Text style={[styles.planBadgeText, {
                  color: isPro ? theme.colors.success : palette.gray[600],
                }]}>
                  {isPro ? 'Pro' : 'Free'}
                </Text>
              </View>
            </View>
          </View>
        </SectionCard>

        {/* ── b) Quick Actions ── */}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            testID="settings-quick-study"
            onPress={() => {
              const nav = navigation.getParent() as any
              nav?.navigate('StudyTab')
            }}
            style={[styles.quickActionCard, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}
          >
            <Text style={styles.quickActionEmoji}>⚡</Text>
            <Text style={[styles.quickActionLabel, { color: '#C2410C' }]}>Quick Study</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="settings-ai-generate"
            onPress={() => navigation.navigate('AIGenerate')}
            style={[styles.quickActionCard, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }]}
          >
            <Text style={styles.quickActionEmoji}>🤖</Text>
            <Text style={[styles.quickActionLabel, { color: '#7C3AED' }]}>AI Generate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="settings-guide-link"
            onPress={() => navigation.navigate('Guide')}
            style={[styles.quickActionCard, { backgroundColor: palette.blue[50], borderColor: palette.blue[200] }]}
          >
            <Text style={styles.quickActionEmoji}>📖</Text>
            <Text style={[styles.quickActionLabel, { color: palette.blue[700] }]}>Guide</Text>
          </TouchableOpacity>
        </View>

        {/* ── Templates ── */}
        <SectionCard theme={theme}>
          <TouchableOpacity
            testID="settings-templates-link"
            onPress={() => navigation.navigate('TemplatesList')}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Card Templates</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                Manage card templates, fields, and layouts
              </Text>
            </View>
            <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
          </TouchableOpacity>
        </SectionCard>

        {/* ── Sharing ── */}
        <SectionCard theme={theme}>
          <TouchableOpacity
            testID="settings-my-shares-link"
            onPress={() => navigation.navigate('MyShares')}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>My Shares</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                Manage shared decks and invites
              </Text>
            </View>
            <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
          </TouchableOpacity>
        </SectionCard>

        {/* ── Publisher Dashboard ── */}
        <SectionCard theme={theme}>
          <TouchableOpacity
            testID="settings-publisher-stats-link"
            onPress={() => navigation.navigate('PublisherStats')}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Publisher Dashboard</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                View stats for your published decks
              </Text>
            </View>
            <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
          </TouchableOpacity>
        </SectionCard>

        {/* ── c) Study Settings ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Study Settings</Text>

          {/* Answer Mode */}
          <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>Answer Mode</Text>
          <View style={styles.modeGrid}>
            {(['button', 'swipe'] as const).map((mode) => {
              const isActive = profile.answer_mode === mode
              return (
                <TouchableOpacity
                  key={mode}
                  testID={`settings-answer-${mode}`}
                  onPress={() => saveProfile({ answer_mode: mode })}
                  style={[
                    styles.modeCard,
                    {
                      backgroundColor: isActive ? palette.blue[50] : theme.colors.surfaceElevated,
                      borderColor: isActive ? palette.blue[500] : theme.colors.border,
                      borderWidth: isActive ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={styles.modeEmoji}>{mode === 'button' ? '👆' : '👋'}</Text>
                  <Text style={[styles.modeLabel, { color: theme.colors.text }]}>
                    {mode === 'button' ? 'Button' : 'Swipe'}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Daily New Card Limit */}
          <View style={styles.settingRow}>
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
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              Maximum new cards shown per day per deck.
            </Text>
          </View>

          {/* TTS */}
          <View style={styles.switchRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Auto TTS Reading</Text>
            <Switch
              testID="settings-tts-toggle"
              value={profile.tts_enabled}
              onValueChange={(v) => saveProfile({ tts_enabled: v })}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          {profile.tts_enabled && (
            <View style={styles.ttsSettings}>
              <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>Voice Engine</Text>
              <View style={styles.modeGrid}>
                {TTS_PROVIDERS.map((prov) => {
                  const isActive = profile.tts_provider === prov.value
                  return (
                    <TouchableOpacity
                      key={prov.value}
                      testID={`settings-tts-provider-${prov.value}`}
                      onPress={() => saveProfile({ tts_provider: prov.value })}
                      style={[
                        styles.modeCard,
                        {
                          backgroundColor: isActive ? palette.blue[50] : theme.colors.surfaceElevated,
                          borderColor: isActive ? palette.blue[500] : theme.colors.border,
                          borderWidth: isActive ? 2 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.modeLabel, { color: theme.colors.text }]}>{prov.label}</Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{prov.desc}</Text>
                      {prov.noteKey ? <Text style={{ fontSize: 11, color: '#F59E0B', marginTop: 2 }}>{t(prov.noteKey, { ns: 'settings' })}</Text> : null}
                    </TouchableOpacity>
                  )
                })}
              </View>
              <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>Reading Speed</Text>
              <View style={styles.sliderRow}>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, width: 28 }]}>0.5x</Text>
                <Slider
                  testID="settings-tts-speed-slider"
                  style={styles.slider}
                  minimumValue={0.5}
                  maximumValue={2.0}
                  step={0.1}
                  value={profile.tts_speed}
                  onValueChange={(v: number) => setProfile((p) => ({ ...p, tts_speed: Math.round(v * 10) / 10 }))}
                  onSlidingComplete={(v: number) => saveProfile({ tts_speed: Math.round(v * 10) / 10 })}
                  minimumTrackTintColor={theme.colors.primary}
                  maximumTrackTintColor={theme.colors.border}
                  thumbTintColor={theme.colors.primary}
                />
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, width: 28 }]}>2.0x</Text>
                <Text style={[theme.typography.label, { color: theme.colors.text, width: 40, textAlign: 'right' }]}>
                  {profile.tts_speed.toFixed(1)}x
                </Text>
              </View>
            </View>
          )}
        </SectionCard>

        {/* ── d) SRS Configuration ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>SRS Configuration</Text>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            Default SRS settings for new decks. Each deck can override these.
          </Text>
          <View style={styles.sectionBody}>
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
          </View>
        </SectionCard>

        {/* ── e) AI Providers (collapsible) ── */}
        <SectionCard theme={theme}>
          <TouchableOpacity
            onPress={() => setAiCollapsed(!aiCollapsed)}
            style={styles.collapsibleHeader}
            activeOpacity={0.7}
          >
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>AI Providers</Text>
            <Text style={[styles.chevron, { color: theme.colors.textTertiary }]}>
              {aiCollapsed ? '▸' : '▾'}
            </Text>
          </TouchableOpacity>
          {!aiCollapsed && (
            <>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                Configure AI providers for card generation. Keys are encrypted locally.
              </Text>
              <View style={styles.sectionBody}>
                {AI_PROVIDERS.map((provider) => {
                  const isEditing = aiEditingProvider === provider.id
                  return (
                    <View key={provider.id} style={[styles.aiProviderCard, { borderColor: theme.colors.border }]}>
                      <View style={styles.aiProviderHeader}>
                        <View style={styles.aiProviderLeft}>
                          <View style={[styles.aiIcon, { backgroundColor: provider.bg }]}>
                            <Text style={[styles.aiIconText, { color: provider.color }]}>AI</Text>
                          </View>
                          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{provider.label}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => setAiEditingProvider(isEditing ? null : provider.id)}
                          testID={`settings-ai-${provider.id}-toggle`}
                          style={[styles.configBtn, { backgroundColor: palette.blue[50] }]}
                        >
                          <Text style={[theme.typography.caption, { color: palette.blue[600], fontWeight: '500' }]}>
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
                <View style={[styles.securityNote, { backgroundColor: theme.colors.surface }]}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    API keys are stored locally on your device using encrypted storage and never sent to our servers.
                  </Text>
                </View>
              </View>
            </>
          )}
        </SectionCard>

        {/* ── f) Language ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Language</Text>
          <TouchableOpacity
            testID="settings-lang-dropdown"
            onPress={() => setLangDropdownOpen(true)}
            style={[styles.dropdown, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceElevated }]}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownFlag}>
              {LANGUAGES.find((l) => l.code === language)?.flag ?? '🌐'}
            </Text>
            <Text style={[styles.dropdownText, { color: theme.colors.text }]}>
              {LANGUAGES.find((l) => l.code === language)?.label ?? 'English'}
            </Text>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>▾</Text>
          </TouchableOpacity>

          <Modal visible={langDropdownOpen} transparent animationType="fade" onRequestClose={() => setLangDropdownOpen(false)}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setLangDropdownOpen(false)}>
              <View style={[styles.modalContent, { backgroundColor: theme.colors.surfaceElevated }]}>
                <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Language</Text>
                <FlatList
                  data={LANGUAGES}
                  keyExtractor={(item) => item.code}
                  renderItem={({ item: lang }) => {
                    const isActive = language === lang.code
                    return (
                      <TouchableOpacity
                        testID={`settings-lang-${lang.code}`}
                        onPress={() => { handleLanguageChange(lang.code); setLangDropdownOpen(false) }}
                        style={[styles.modalItem, isActive && { backgroundColor: palette.blue[50] }]}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.langFlag}>{lang.flag}</Text>
                        <Text style={[styles.modalItemText, { color: isActive ? theme.colors.primary : theme.colors.text }]}>
                          {lang.label}
                        </Text>
                        {isActive && <Text style={{ color: theme.colors.primary, fontSize: 16 }}>✓</Text>}
                      </TouchableOpacity>
                    )
                  }}
                />
              </View>
            </TouchableOpacity>
          </Modal>
        </SectionCard>

        {/* ── g) Notifications ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Notifications</Text>
          <View style={styles.switchRow}>
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
        </SectionCard>

        {/* ── h) Subscription ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Subscription</Text>
          <View style={[styles.subCard, {
            backgroundColor: isPro ? theme.colors.successLight : theme.colors.surface,
            borderColor: isPro ? theme.colors.success : theme.colors.border,
          }]}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>
              {isPro ? 'Pro' : 'Free Plan'}
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
          {isPro && (
            <Button
              testID="settings-manage-subscription"
              title="Manage Subscription"
              variant="outline"
              onPress={() => Linking.openURL(MANAGE_SUBSCRIPTIONS_URL)}
            />
          )}
        </SectionCard>

        {/* ── i) Legal (compact inline links) ── */}
        <View style={styles.legalRow}>
          <TouchableOpacity
            testID="settings-privacy-policy"
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          >
            <Text style={[styles.legalLink, { color: theme.colors.textSecondary }]}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={[styles.legalDot, { color: theme.colors.textTertiary }]}>·</Text>
          <TouchableOpacity
            testID="settings-terms-of-service"
            onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
          >
            <Text style={[styles.legalLink, { color: theme.colors.textSecondary }]}>Terms of Service</Text>
          </TouchableOpacity>
        </View>

        {/* ── j) Account (bottom, clear separation) ── */}
        <View style={[styles.accountDivider, { borderTopColor: theme.colors.border }]} />

        <TouchableOpacity
          testID="settings-logout"
          accessibilityLabel="settings-logout"
          onPress={handleLogout}
          style={[styles.logoutBtn, { borderColor: palette.gray[300] }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.logoutText, { color: palette.gray[600] }]}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="settings-delete-account"
          onPress={handleDeleteAccount}
          style={styles.deleteLink}
        >
          <Text style={[styles.deleteLinkText, { color: palette.red[500] }]}>Delete Account</Text>
        </TouchableOpacity>

        <Text style={[styles.versionText, { color: theme.colors.textTertiary }]}>
          ReeeeecallStudy v{APP_VERSION}
        </Text>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
  )
}

/**
 * Card-based section
 */
function SectionCard({ children, theme }: {
  children: React.ReactNode; theme: ReturnType<typeof useTheme>
}) {
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  // Profile
  profileRow: { gap: 16 },
  avatarCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  profileInfo: { gap: 8 },
  emailText: { fontSize: 13, textAlign: 'center' },
  planBadge: {
    alignSelf: 'center',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1,
  },
  planBadgeText: { fontSize: 12, fontWeight: '600' },

  // Quick Actions
  quickActionsRow: {
    flexDirection: 'row', gap: 10, marginBottom: 12,
  },
  quickActionCard: {
    flex: 1, alignItems: 'center', gap: 6,
    paddingVertical: 16, paddingHorizontal: 8,
    borderRadius: 12, borderWidth: 1,
  },
  quickActionEmoji: { fontSize: 24 },
  quickActionLabel: { fontSize: 12, fontWeight: '600' },

  // Section card
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '600' },
  sectionBody: { gap: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 4 },
  settingRow: { gap: 4 },

  // Language dropdown
  dropdown: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 10, borderWidth: 1.5,
  },
  dropdownFlag: { fontSize: 20 },
  dropdownText: { flex: 1, fontSize: 15, fontWeight: '500' },
  langFlag: { fontSize: 20 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center', padding: 40,
  },
  modalContent: {
    width: '100%', maxWidth: 320, borderRadius: 16,
    paddingVertical: 12, maxHeight: 400,
  },
  modalTitle: {
    fontSize: 16, fontWeight: '600', paddingHorizontal: 20, paddingVertical: 12,
  },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  modalItemText: { flex: 1, fontSize: 15, fontWeight: '500' },

  // Mode cards
  modeGrid: { flexDirection: 'row', gap: 10 },
  modeCard: { flex: 1, padding: 14, borderRadius: 12, gap: 4 },
  modeEmoji: { fontSize: 24 },
  modeLabel: { fontSize: 14, fontWeight: '600' },

  // Switch row
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  // TTS settings
  ttsSettings: { gap: 12 },

  // Speed slider
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  slider: { flex: 1, height: 40 },

  // SRS
  srsRow: { flexDirection: 'row', gap: 12 },
  srsField: { flex: 1 },

  // Collapsible
  collapsibleHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  chevron: { fontSize: 16 },

  // AI Providers
  aiProviderCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  aiProviderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiProviderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  aiIconText: { fontSize: 12, fontWeight: '700' },
  configBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  aiEditForm: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  securityNote: { padding: 12, borderRadius: 8 },

  // Subscription
  subCard: { padding: 16, borderRadius: 12, borderWidth: 1.5, gap: 4 },

  // Legal (compact inline)
  legalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, gap: 8,
  },
  legalLink: { fontSize: 13 },
  legalDot: { fontSize: 13 },

  // Account section (bottom)
  accountDivider: { borderTopWidth: 1, marginTop: 8, marginBottom: 16 },
  logoutBtn: {
    borderWidth: 1.5, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
    marginBottom: 12,
  },
  logoutText: { fontSize: 15, fontWeight: '500' },
  deleteLink: { alignItems: 'center', paddingVertical: 8 },
  deleteLinkText: { fontSize: 13 },
  versionText: { fontSize: 11, textAlign: 'center', marginTop: 12 },

  bottomSpacer: { height: 20 },
})
