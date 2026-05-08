import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, TouchableOpacity, Switch, ScrollView, Alert, StyleSheet, Linking, Modal, FlatList, Share } from 'react-native'
import * as Updates from 'expo-updates'
import Slider from '@react-native-community/slider'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple Guideline 2.1(b) 리젝 대응
// IAP products를 함께 submit 하기 전까지 구독 UI 전부 숨김.
// 복원 시: usePurchases import 복구, isPro stub 제거, planBadge + Subscription 섹션 복원.
import { useAuth, useAuthState } from '../hooks'
// import { useAuth, useAuthState, usePurchases } from '../hooks'
import { useTheme, palette } from '../theme'
import { useThemeStore } from '../stores/theme-store'
import type { SettingsStackParamList } from '../navigation/types'
import { notificationService } from '../services/notifications'
import { getMobileSupabase } from '../adapters'
import type { SrsSettings } from '@reeeeecall/shared/types/database'
import { DEFAULT_SRS_SETTINGS } from '@reeeeecall/shared/types/database'
import { aiKeyVault } from '@reeeeecall/shared/lib/ai/secure-storage'
import type { ProviderKeyMap } from '@reeeeecall/shared/lib/ai/secure-storage'

// SECURITY: Supabase 서버사이드 암호화 사용 (pgcrypto + Vault)
// 로컬 SecureStore 대신 서버에 암호화 저장 → 웹/모바일 동기화
const mobileAiKeyVault = aiKeyVault

const PRIVACY_POLICY_URL = 'https://reeeeecallstudy.xyz/privacy-policy.html'
const TERMS_OF_SERVICE_URL = 'https://reeeeecallstudy.xyz/terms-of-service.html'
// [SUBSCRIPTION-HIDDEN] 구독 관리 URL — 복원 시 주석 해제
// const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const APP_VERSION = '1.0.0'

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'vi', label: 'Tieng Viet', flag: '🇻🇳' },
  { code: 'th', label: 'Thai', flag: '🇹🇭' },
  { code: 'id', label: 'Bahasa', flag: '🇮🇩' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
]

const TTS_PROVIDERS = [
  { value: 'web_speech' as const, label: 'Device Voice', desc: "Uses your device's built-in voice", noteKey: '' },
  { value: 'edge_tts' as const, label: 'Edge TTS', desc: 'Higher quality neural voice', noteKey: 'tts.edgeTtsNote' },
]

const AI_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', color: palette.green[600], bg: palette.green[50], models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'] },
  { id: 'google', label: 'Google Gemini', color: palette.blue[600], bg: palette.blue[50], models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] },
  { id: 'anthropic', label: 'Anthropic', color: palette.yellow[700], bg: palette.yellow[50], models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6'] },
  { id: 'xai', label: 'xAI (Grok)', color: palette.gray[900], bg: palette.gray[100], models: ['grok-3-mini', 'grok-3'] },
]

interface ProfileData {
  display_name: string
  daily_new_limit: number
  daily_study_goal: number | null
  tts_enabled: boolean
  tts_speed: number
  tts_provider: 'web_speech' | 'edge_tts'
  answer_mode: 'button' | 'swipe'
  answer_timing: 'before' | 'same' | 'after'
}

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'SettingsHome'>

export function SettingsScreen() {
  const theme = useTheme()
  const { t, i18n } = useTranslation('settings')
  const navigation = useNavigation<Nav>()
  const { user } = useAuthState()
  const { signOut } = useAuth()
  const setUserTheme = useThemeStore((s) => s.setUserTheme)
  // [SUBSCRIPTION-HIDDEN] usePurchases 훅 호출 보류 — 복원 시 아래 stub 제거하고 원래 줄 복구
  // const { isPro } = usePurchases()

  const [profile, setProfile] = useState<ProfileData>({
    display_name: '',
    daily_new_limit: 20,
    daily_study_goal: null,
    tts_enabled: false,
    tts_speed: 0.9,
    tts_provider: 'web_speech',
    answer_mode: 'button',
    answer_timing: 'after',
  })
  const [language, setLanguage] = useState(i18n.language || 'en')
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system')
  const [langDropdownOpen, setLangDropdownOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Display name: debounced duplicate check (matches web SettingsPage.tsx)
  const [savedDisplayName, setSavedDisplayName] = useState('')
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameChecking, setNameChecking] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const [aiEditModel, setAiEditModel] = useState('')
  const [aiKeys, setAiKeys] = useState<ProviderKeyMap>({})
  const [aiSaving, setAiSaving] = useState(false)

  // Load AI keys
  useEffect(() => {
    if (!user) return
    mobileAiKeyVault.loadAll(user.id).then(setAiKeys).catch(() => {})
  }, [user])

  // Load profile
  useEffect(() => {
    if (!user) return
    const supabase = getMobileSupabase()
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('[Settings] profile load error:', error.message)
          return
        }
        if (data) {
          const p = data as Record<string, unknown>
          console.log('[Settings] profile loaded:', { display_name: p.display_name })
          setProfile({
            display_name: (p.display_name as string) ?? '',
            daily_new_limit: (p.daily_new_limit as number) ?? 20,
            daily_study_goal: (p.daily_study_goal as number | null) ?? null,
            tts_enabled: (p.tts_enabled as boolean) ?? false,
            tts_speed: (p.tts_speed as number) ?? 0.9,
            tts_provider: (p.tts_provider as ProfileData['tts_provider']) ?? 'web_speech',
            answer_mode: (p.answer_mode as ProfileData['answer_mode']) ?? 'button',
            answer_timing: (p.answer_timing as ProfileData['answer_timing']) ?? 'after',
          })
          setSavedDisplayName((p.display_name as string) ?? '')
          const lang = p.language as string | undefined
          if (lang) {
            setLanguage(lang)
            i18n.changeLanguage(lang)
          }
          const savedTheme = p.theme as 'light' | 'dark' | 'system' | undefined
          if (savedTheme) {
            setThemeMode(savedTheme)
            setUserTheme(savedTheme)
          }
        }
      })
  }, [user])

  // Display name: debounced availability check
  const checkNameAvailability = useCallback(async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === savedDisplayName) {
      setNameAvailable(null)
      setNameError(null)
      setNameChecking(false)
      return
    }
    if (trimmed.length < 2 || trimmed.length > 12) {
      setNameAvailable(false)
      setNameError('2-12 characters required')
      setNameChecking(false)
      return
    }
    setNameChecking(true)
    const supabase = getMobileSupabase()
    const { data } = await supabase.rpc('check_nickname_available', { p_nickname: trimmed })
    const result = data as { available: boolean; error?: string } | null
    if (result?.error === 'invalid_length') {
      setNameAvailable(false)
      setNameError('2-12 characters required')
    } else if (result?.available === false) {
      setNameAvailable(false)
      setNameError('Name already taken')
    } else {
      setNameAvailable(true)
      setNameError(null)
    }
    setNameChecking(false)
  }, [savedDisplayName])

  const handleNameChange = useCallback((value: string) => {
    setProfile((p) => ({ ...p, display_name: value }))
    setNameAvailable(null)
    setNameError(null)
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current)
    const trimmed = value.trim()
    if (!trimmed || trimmed === savedDisplayName) return
    nameCheckTimer.current = setTimeout(() => checkNameAvailability(value), 500)
  }, [savedDisplayName, checkNameAvailability])



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

  const handleSaveName = useCallback(async () => {
    if (!user) return
    const trimmed = profile.display_name.trim()
    if (trimmed === savedDisplayName) return
    if (trimmed && (trimmed.length < 2 || trimmed.length > 12)) return
    if (nameAvailable === false) return
    setNameSaving(true)
    await saveProfile({ display_name: trimmed || '' })
    setSavedDisplayName(trimmed)
    setNameAvailable(null)
    setNameError(null)
    setNameSaving(false)
    Alert.alert('Saved', 'Display name updated.')
  }, [user, profile.display_name, savedDisplayName, nameAvailable, saveProfile])

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
    <Screen safeArea padding={false} keyboard testID="settings-screen">
      <ScreenHeader title={t('title')} mode="drawer" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── a) Profile — centered avatar like web ── */}
        <SectionCard theme={theme}>
          <View style={styles.profileCentered}>
            <View style={[styles.avatarCircle, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.avatarText}>{userInitial}</Text>
            </View>
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{user?.email}</Text>
            {/* ──────────────────────────────────────────────────────────────────── */}
            {/* [SUBSCRIPTION-HIDDEN] Plan 배지 (Free/Pro) — 2026-04-15 심사 리젝 대응 */}
            {/* 복원 시 아래 블록 주석 해제 */}
            {/* <View style={[styles.planBadge, {
              backgroundColor: isPro ? theme.colors.successLight : theme.colors.surface,
              borderColor: isPro ? theme.colors.success : theme.colors.border,
            }]}>
              <Text style={[styles.planBadgeText, { color: isPro ? theme.colors.success : theme.colors.textSecondary }]}>
                {isPro ? 'Pro' : 'Free'}
              </Text>
            </View> */}
            {/* ──────────────────────────────────────────────────────────────────── */}
          </View>
          <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>Display name</Text>
          <View style={styles.nameRow}>
            <View style={{ flex: 1 }}>
              <TextInput
                testID="settings-display-name"
                value={profile.display_name}
                onChangeText={handleNameChange}
                placeholder="2-12 characters"
                maxLength={12}
              />
            </View>
            <Button
              testID="settings-save-name"
              title={nameSaving ? '...' : 'Save'}
              variant="primary"
              size="sm"
              fullWidth={false}
              disabled={
                nameSaving ||
                nameChecking ||
                nameAvailable === false ||
                profile.display_name.trim() === savedDisplayName ||
                !profile.display_name.trim()
              }
              loading={nameSaving}
              onPress={handleSaveName}
            />
          </View>
          {nameChecking && (
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
              Checking availability...
            </Text>
          )}
          {nameError && (
            <Text style={[theme.typography.caption, { color: theme.colors.error, marginTop: 4 }]}>
              {nameError}
            </Text>
          )}
          {nameAvailable === true && !nameChecking && (
            <Text style={[theme.typography.caption, { color: theme.colors.success, marginTop: 4 }]}>
              Name available!
            </Text>
          )}
        </SectionCard>

        {/* ── b) Quick Actions — circles like web ── */}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            testID="settings-quick-study"
            onPress={() => { const nav = navigation.getParent() as any; nav?.navigate('StudyTab') }}
            style={styles.quickActionItem}
          >
            <View style={[styles.quickActionCircle, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={{ fontSize: 22 }}>{'\u26A1'}</Text>
            </View>
            <Text style={[styles.quickActionLabel, { color: theme.colors.text }]}>Quick{'\n'}Study</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="settings-ai-generate"
            onPress={() => navigation.navigate('AIGenerate')}
            style={styles.quickActionItem}
          >
            <View style={[styles.quickActionCircle, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={{ fontSize: 22 }}>{'\uD83E\uDD16'}</Text>
            </View>
            <Text style={[styles.quickActionLabel, { color: theme.colors.text }]}>AI{'\n'}Generate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="settings-invite-link"
            onPress={() => Share.share({ message: 'Check out ReeeeecallStudy — the smartest flashcard app! https://reeeeecall.com' })}
            style={styles.quickActionItem}
          >
            <View style={[styles.quickActionCircle, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={{ fontSize: 22 }}>{'\uD83D\uDCE7'}</Text>
            </View>
            <Text style={[styles.quickActionLabel, { color: theme.colors.text }]}>Invite</Text>
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

        {/* ── Answer Mode — matches web: standalone card ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Answer Mode</Text>
          <View style={styles.segmentRow}>
            {(['before', 'same', 'after'] as const).map((timing) => {
              const isActive = profile.answer_timing === timing
              const labels = { before: 'Before', same: 'Same', after: 'After' }
              return (
                <TouchableOpacity
                  key={timing}
                  testID={`settings-timing-${timing}`}
                  onPress={() => saveProfile({ answer_timing: timing })}
                  style={[
                    styles.segmentButton,
                    {
                      backgroundColor: isActive ? palette.blue[500] : theme.colors.surface,
                      borderColor: isActive ? palette.blue[500] : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.segmentLabel, { color: isActive ? '#FFFFFF' : theme.colors.text }]}>
                    {labels[timing]}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Rate directly on the front card (tap answer before flipping) or see answer first.
          </Text>
        </SectionCard>

        {/* ── New Card Limit — standalone card ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>New Card Limit</Text>
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
                      backgroundColor: isActive ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                      borderColor: isActive ? theme.colors.primary : theme.colors.border,
                      borderWidth: isActive ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={styles.modeEmoji}>{mode === 'button' ? '👆' : '👋'}</Text>
                  <Text style={[styles.modeLabel, { color: isActive ? theme.colors.primary : theme.colors.text }]}>
                    {mode === 'button' ? 'Button' : 'Swipe'}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <TextInput
            testID="settings-daily-limit"
            value={String(profile.daily_new_limit)}
            onChangeText={(v) => {
              const clean = v.replace(/[^0-9]/g, '')
              setProfile((p) => ({ ...p, daily_new_limit: clean === '' ? 0 : parseInt(clean) }))
            }}
            onBlur={() => {
              const clamped = Math.max(1, Math.min(9999, profile.daily_new_limit || 1))
              setProfile((p) => ({ ...p, daily_new_limit: clamped }))
              saveProfile({ daily_new_limit: clamped })
            }}
            keyboardType="number-pad"
          />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            The number of new cards automatically added to your daily review queue per deck.
          </Text>
        </SectionCard>

        {/* ── Auto TTS Reading — standalone card ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Auto TTS Reading</Text>
          <View style={styles.switchRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Enable auto reading</Text>
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
                          backgroundColor: isActive ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                          borderColor: isActive ? theme.colors.primary : theme.colors.border,
                          borderWidth: isActive ? 2 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.modeLabel, { color: isActive ? theme.colors.primary : theme.colors.text }]}>{prov.label}</Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{prov.desc}</Text>
                      {prov.noteKey ? <Text style={{ fontSize: 11, color: palette.yellow[500], marginTop: 2 }}>{t(prov.noteKey, { ns: 'settings' })}</Text> : null}
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

        {/* ── Daily Study Goal — standalone like web ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Daily Study Goal</Text>
          <TextInput
            testID="settings-daily-goal"
            value={profile.daily_study_goal != null ? String(profile.daily_study_goal) : ''}
            onChangeText={(v) => {
              const clean = v.replace(/[^0-9]/g, '')
              setProfile((p) => ({ ...p, daily_study_goal: clean === '' ? null : parseInt(clean) }))
            }}
            onBlur={() => {
              const goal = profile.daily_study_goal
              if (goal !== null) {
                const clamped = Math.max(1, Math.min(480, goal || 1))
                setProfile((p) => ({ ...p, daily_study_goal: clamped }))
                saveProfile({ daily_study_goal: clamped })
              } else {
                saveProfile({ daily_study_goal: null })
              }
            }}
            keyboardType="number-pad"
            placeholder="e.g. 30"
          />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Set a daily study target in minutes. Leave empty for no goal.
          </Text>
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
                  onChangeText={(v) => {
                    const clean = v.replace(/[^0-9]/g, '')
                    setSrsSettings((p) => ({ ...p, good_days: clean === '' ? 0 : parseInt(clean) }))
                  }}
                  onBlur={() => setSrsSettings((p) => ({ ...p, good_days: Math.max(1, Math.min(365, p.good_days || 1)) }))}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.srsField}>
                <TextInput
                  testID="settings-srs-easy-interval"
                  label="Easy Interval (days)"
                  value={String(srsSettings.easy_days)}
                  onChangeText={(v) => {
                    const clean = v.replace(/[^0-9]/g, '')
                    setSrsSettings((p) => ({ ...p, easy_days: clean === '' ? 0 : parseInt(clean) }))
                  }}
                  onBlur={() => setSrsSettings((p) => ({ ...p, easy_days: Math.max(1, Math.min(365, p.easy_days || 4)) }))}
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
            <Text style={[styles.chevron, { color: theme.colors.textSecondary }]}>
              {aiCollapsed ? '∨' : '∧'}
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
                  const isConfigured = !!aiKeys[provider.id]
                  return (
                    <View key={provider.id} style={[styles.aiProviderCard, { borderColor: theme.colors.border }]}>
                      {/* Toggle header */}
                      <TouchableOpacity
                        onPress={() => {
                          if (isEditing) {
                            setAiEditingProvider(null)
                            setAiApiKey('')
                            setAiEditModel('')
                          } else {
                            const existing = aiKeys[provider.id]
                            setAiEditingProvider(provider.id)
                            setAiApiKey(existing?.apiKey ?? '')
                            setAiEditModel(existing?.model ?? provider.models[0])
                          }
                        }}
                        testID={`settings-ai-${provider.id}-toggle`}
                        style={styles.aiProviderHeader}
                        activeOpacity={0.6}
                      >
                        <View style={styles.aiProviderLeft}>
                          <View style={[styles.aiIcon, { backgroundColor: theme.colors.primaryLight }]}>
                            <Text style={[styles.aiIconText, { color: theme.colors.primary }]}>AI</Text>
                          </View>
                          <Text style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]}>{provider.label}</Text>
                          {isConfigured ? (
                            <View style={[styles.aiBadge, { backgroundColor: theme.colors.successLight }]}>
                              <Text style={[theme.typography.caption, { color: theme.colors.success, fontWeight: '500' }]}>Configured</Text>
                            </View>
                          ) : (
                            <View style={[styles.aiBadge, { backgroundColor: theme.colors.surface }]}>
                              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, fontWeight: '500' }]}>Not Set</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>
                          {isEditing ? '∧' : '∨'}
                        </Text>
                      </TouchableOpacity>

                      {/* Expanded edit form */}
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
                          <Text style={[theme.typography.label, { color: theme.colors.text, marginTop: 4 }]}>Model</Text>
                          {provider.models.map((model) => (
                            <TouchableOpacity
                              key={model}
                              onPress={() => setAiEditModel(model)}
                              style={[styles.modelOption, {
                                borderColor: aiEditModel === model ? theme.colors.primary : theme.colors.border,
                                backgroundColor: aiEditModel === model ? theme.colors.primaryLight : theme.colors.surfaceElevated,
                              }]}
                            >
                              <Text style={[theme.typography.bodySmall, {
                                color: aiEditModel === model ? theme.colors.primary : theme.colors.text,
                                fontWeight: aiEditModel === model ? '600' : '400',
                              }]}>{model}</Text>
                            </TouchableOpacity>
                          ))}
                          <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
                            <View style={{ flex: 1 }}>
                              <Button
                                title={aiSaving ? 'Saving...' : 'Save'}
                                size="sm"
                                disabled={aiSaving || !aiApiKey.trim()}
                                onPress={async () => {
                                  if (!user || !aiApiKey.trim()) return
                                  setAiSaving(true)
                                  try {
                                    await mobileAiKeyVault.saveProvider(user.id, provider.id, {
                                      apiKey: aiApiKey.trim(),
                                      model: aiEditModel || provider.models[0],
                                      savedAt: new Date().toISOString(),
                                    })
                                    const keys = await mobileAiKeyVault.loadAll(user.id)
                                    setAiKeys(keys)
                                    setAiEditingProvider(null)
                                    setAiApiKey('')
                                    setAiEditModel('')
                                    Alert.alert('Saved', `${provider.label} API key saved successfully.`)
                                  } catch {
                                    Alert.alert('Error', 'Failed to save API key.')
                                  } finally {
                                    setAiSaving(false)
                                  }
                                }}
                                testID={`settings-ai-${provider.id}-save`}
                              />
                            </View>
                            {isConfigured && (
                              <TouchableOpacity
                                onPress={async () => {
                                  if (!user) return
                                  await mobileAiKeyVault.removeProvider(user.id, provider.id)
                                  const keys = await mobileAiKeyVault.loadAll(user.id)
                                  setAiKeys(keys)
                                  setAiEditingProvider(null)
                                  setAiApiKey('')
                                  setAiEditModel('')
                                  Alert.alert('Deleted', `${provider.label} API key removed.`)
                                }}
                                testID={`settings-ai-${provider.id}-delete`}
                                style={[styles.configBtn, { backgroundColor: theme.colors.errorLight }]}
                              >
                                <Text style={[theme.typography.caption, { color: theme.colors.error, fontWeight: '500' }]}>Delete</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              onPress={() => {
                                setAiEditingProvider(null)
                                setAiApiKey('')
                                setAiEditModel('')
                              }}
                              style={[styles.configBtn, { backgroundColor: theme.colors.surface }]}
                            >
                              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, fontWeight: '500' }]}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
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
            <Text style={{ color: theme.colors.textSecondary, fontSize: 18, fontWeight: '300' }}>∨</Text>
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
                        style={[styles.modalItem, isActive && { backgroundColor: theme.colors.primaryLight }]}
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

        {/* ── Theme ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Theme</Text>
          <View style={styles.segmentRow}>
            {(['light', 'dark', 'system'] as const).map((mode) => {
              const isActive = themeMode === mode
              const labels = { light: 'Light', dark: 'Dark', system: 'System' }
              return (
                <TouchableOpacity
                  key={mode}
                  testID={`settings-theme-${mode}`}
                  onPress={async () => {
                    setThemeMode(mode)
                    setUserTheme(mode)
                    if (user) {
                      const supabase = getMobileSupabase()
                      await supabase.from('profiles').update({ theme: mode }).eq('id', user.id)
                    }
                  }}
                  style={[
                    styles.segmentButton,
                    {
                      backgroundColor: isActive ? palette.blue[500] : theme.colors.surface,
                      borderColor: isActive ? palette.blue[500] : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.segmentLabel, { color: isActive ? '#FFFFFF' : theme.colors.text }]}>
                    {labels[mode]}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
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

        {/* ──────────────────────────────────────────────────────────────────── */}
        {/* [SUBSCRIPTION-HIDDEN] h) Subscription 섹션 — 2026-04-15 심사 리젝 대응  */}
        {/* Apple Guideline 2.1(b): IAP products 미제출 상태에서 구독 UI 노출 금지. */}
        {/* IAP 제출 완료 후 복원 시 전체 블록 주석 해제 + usePurchases 훅 복구.     */}
        {/* ──────────────────────────────────────────────────────────────────── */}
        {/*
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
        */}

        {/* ── i) Export My Data — matches web ── */}
        <SectionCard theme={theme}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Export My Data</Text>
          {[
            { key: 'stats', icon: '📊', label: 'Study Statistics' },
            { key: 'sessions', icon: '📅', label: 'Study Sessions' },
            { key: 'decks', icon: '📚', label: 'Decks' },
            { key: 'cards', icon: '🃏', label: 'Cards' },
          ].map((item) => (
            <TouchableOpacity
              key={item.key}
              testID={`settings-export-${item.key}`}
              onPress={() => navigation.navigate('ImportExport' as never)}
              style={[styles.exportRow, { borderColor: theme.colors.border }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>{item.label}</Text>
              </View>
              <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
            </TouchableOpacity>
          ))}
        </SectionCard>

        {/* ── j) Legal (compact inline links) ── */}
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
          style={[styles.logoutBtn, { borderColor: theme.colors.border }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.logoutText, { color: theme.colors.textSecondary }]}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="settings-delete-account"
          onPress={handleDeleteAccount}
          style={styles.deleteLink}
        >
          <Text style={[styles.deleteLinkText, { color: theme.colors.error }]}>Delete Account</Text>
        </TouchableOpacity>

        <Text style={[styles.versionText, { color: theme.colors.textTertiary }]}>
          ReeeeecallStudy v{APP_VERSION}
        </Text>
        <TouchableOpacity
          onPress={() => {
            const info = [
              `Update ID: ${Updates.updateId ?? 'embedded (no OTA applied)'}`,
              `Channel: ${Updates.channel || 'n/a'}`,
              `Runtime: ${Updates.runtimeVersion || 'n/a'}`,
              `Created: ${Updates.createdAt?.toISOString() ?? 'n/a'}`,
              `isEmbeddedLaunch: ${Updates.isEmbeddedLaunch}`,
              `isEmergencyLaunch: ${Updates.isEmergencyLaunch}`,
            ].join('\n')
            Alert.alert('Build / OTA Info', info, [
              { text: 'Check for update now', onPress: async () => {
                try {
                  const r = await Updates.checkForUpdateAsync()
                  if (r.isAvailable) {
                    await Updates.fetchUpdateAsync()
                    Alert.alert('Downloaded', 'Restart app to apply.')
                  } else {
                    Alert.alert('Up to date', 'No newer update available.')
                  }
                } catch (e: any) {
                  Alert.alert('Check failed', String(e?.message ?? e))
                }
              }},
              { text: 'Reload now', onPress: () => Updates.reloadAsync().catch(() => {}) },
              { text: 'Close', style: 'cancel' },
            ])
          }}
        >
          <Text style={[styles.versionText, { color: theme.colors.textTertiary }]}>
            OTA: {Updates.updateId ? Updates.updateId.slice(0, 8) : 'embedded'} · {Updates.channel || 'n/a'}
          </Text>
        </TouchableOpacity>

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

  // Profile — centered like web
  profileCentered: { alignItems: 'center', gap: 8 },
  avatarCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#FFFFFF' },
  planBadge: {
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1,
  },
  planBadgeText: { fontSize: 12, fontWeight: '600' },

  // Quick Actions — circles like web
  quickActionsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 12,
  },
  quickActionItem: { alignItems: 'center', gap: 6 },
  quickActionCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  quickActionLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },

  // Section card
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '600' },
  sectionBody: { gap: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
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
  chevron: { fontSize: 18, fontWeight: '300' },

  // AI Providers
  aiProviderCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  aiProviderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  aiProviderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  aiIcon: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  aiIconText: { fontSize: 12, fontWeight: '700' },
  configBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  aiEditForm: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  aiBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  modelOption: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
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

  // Segment buttons (Answer Timing, Theme)
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentButton: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  segmentLabel: { fontSize: 14, fontWeight: '600' },

  // Export
  exportRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
  },
})
