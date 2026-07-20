import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, TouchableOpacity, Switch, ScrollView, Alert, StyleSheet, Linking, Modal, FlatList, Share } from 'react-native'
import * as Updates from 'expo-updates'
import Slider from '@react-native-community/slider'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { CollapsibleSection } from '../components/settings/CollapsibleSection'
import { WalletSummary } from '../components/settings/WalletSummary'
import { PlanSelector, UNLIMITED_CARD_LIMIT } from '../components/settings/PlanSelector'
import { CardUsagePanel } from '../components/settings/CardUsagePanel'
import { SUBSCRIPTION_UI_ENABLED } from '../services/purchases'
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple Guideline 2.1(b) 리젝 대응
// IAP products를 함께 submit 하기 전까지 구독 UI 전부 숨김.
// 복원 시: usePurchases import 복구, isPro stub 제거, planBadge + Subscription 섹션 복원.
import { useAuth, useAuthState } from '../hooks'
// import { useAuth, useAuthState, usePurchases } from '../hooks'
import { useTheme, palette } from '../theme'
import { useThemeStore } from '../stores/theme-store'
import {
  useDeckStore,
  registerCardUsageDetailInterest,
  releaseCardUsageDetailInterest,
} from '@reeeeecall/shared/stores/deck-store'
import { localPrefs } from '../utils/local-prefs'
import { haptics, setHapticsEnabled } from '../utils/haptics'
import type { SettingsStackParamList } from '../navigation/types'
import { notificationService } from '../services/notifications'
import { getMobileSupabase } from '../adapters'
import { getMySubscription, type MySubscription } from '../services/billing'
import type { SrsSettings } from '@reeeeecall/shared/types/database'
import { DEFAULT_SRS_SETTINGS } from '@reeeeecall/shared/types/database'

const PRIVACY_POLICY_URL = 'https://reeeeecallstudy.xyz/privacy-policy.html'
const TERMS_OF_SERVICE_URL = 'https://reeeeecallstudy.xyz/terms-of-service.html'
// [SUBSCRIPTION-HIDDEN] 구독 관리 URL — 복원 시 주석 해제
// const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'
const APP_VERSION = '1.0.1'

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
  { value: 'web_speech' as const, labelKey: 'tts.deviceVoice', descKey: 'tts.deviceVoiceDesc', noteKey: '' },
  { value: 'edge_tts' as const, labelKey: 'tts.edgeTts', descKey: 'tts.edgeTtsDesc', noteKey: 'tts.edgeTtsNote' },
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
  const { t: tWallet } = useTranslation('wallet')
  const navigation = useNavigation<Nav>()
  const { user } = useAuthState()
  const { signOut } = useAuth()
  const setUserTheme = useThemeStore((s) => s.setUserTheme)
  const cardUsage = useDeckStore((s) => s.cardUsage)
  const fetchCardUsage = useDeckStore((s) => s.fetchCardUsage)
  const cardUsageDetail = useDeckStore((s) => s.cardUsageDetail)
  const fetchCardUsageDetail = useDeckStore((s) => s.fetchCardUsageDetail)
  useEffect(() => {
    registerCardUsageDetailInterest()
    void fetchCardUsage()
    void fetchCardUsageDetail()
    return () => releaseCardUsageDetailInterest()
  }, [fetchCardUsage, fetchCardUsageDetail])
  // Surface subscription state on the plan / card-limit section. Auth-scoped RPC
  // (get_my_subscription) — returns null for free users. NOT gated behind the
  // mobile paywall: a sub can be granted by the WEB paywall too, so a user who
  // subscribed (and then canceled) on web should see the "canceling on <date>"
  // note here. This only INFORMS — the client never grants (grant is server-side).
  const [subscription, setSubscription] = useState<MySubscription | null>(null)
  useEffect(() => {
    if (!user) { setSubscription(null); return }
    getMySubscription().then(setSubscription)
  }, [user?.id])
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
  const [hapticsOn, setHapticsOn] = useState(localPrefs.getHapticsEnabled())
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

  // SRS Settings (per-deck default)
  const [srsSettings, setSrsSettings] = useState<SrsSettings>(DEFAULT_SRS_SETTINGS)
  const [learningStepsText, setLearningStepsText] = useState(
    DEFAULT_SRS_SETTINGS.learning_steps?.join(', ') ?? '1, 10',
  )

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
      setNameError(t('profile.nameLengthError'))
      setNameChecking(false)
      return
    }
    setNameChecking(true)
    const supabase = getMobileSupabase()
    const { data } = await supabase.rpc('check_nickname_available', { p_nickname: trimmed })
    const result = data as { available: boolean; error?: string } | null
    if (result?.error === 'invalid_length') {
      setNameAvailable(false)
      setNameError(t('profile.nameLengthError'))
    } else if (result?.available === false) {
      setNameAvailable(false)
      setNameError(t('profile.nameTaken'))
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
        Alert.alert(t('notifications.permissionTitle'), t('notifications.permissionRequired'))
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
    Alert.alert(t('profile.savedTitle'), t('profile.savedMessage'))
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
      t('account.deleteAccount'),
      t('account.deleteConfirm'),
      [
        { text: t('actions.cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('account.deleteAccount'),
          style: 'destructive',
          onPress: async () => {
            try {
              const supabase = getMobileSupabase()
              const { error } = await supabase.rpc('delete_user_account')
              if (error) {
                Alert.alert(t('alerts.error'), t('account.deleteFailed'))
                return
              }
              await signOut()
            } catch {
              Alert.alert(t('alerts.error'), t('account.deleteFailed'))
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
        <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 12, marginTop: -4, marginLeft: 4 }}>{t('subtitle')}</Text>

        <GroupLabel theme={theme}>{t('groups.account')}</GroupLabel>

        {/* ── a) Profile — centered avatar like web ── */}
        <CollapsibleSection title={t('profile.title')} icon="👤">
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
          <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>{t('profile.displayName')}</Text>
          <View style={styles.nameRow}>
            <View style={{ flex: 1 }}>
              <TextInput
                testID="settings-display-name"
                value={profile.display_name}
                onChangeText={handleNameChange}
                placeholder={t('profile.displayNamePlaceholder')}
                maxLength={12}
              />
            </View>
            <Button
              testID="settings-save-name"
              title={nameSaving ? '...' : t('profile.save')}
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
              {t('profile.checkingName')}
            </Text>
          )}
          {nameError && (
            <Text style={[theme.typography.caption, { color: theme.colors.error, marginTop: 4 }]}>
              {nameError}
            </Text>
          )}
          {nameAvailable === true && !nameChecking && (
            <Text style={[theme.typography.caption, { color: theme.colors.success, marginTop: 4 }]}>
              {t('profile.nameAvailable')}
            </Text>
          )}
        </CollapsibleSection>

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
            <Text style={[styles.quickActionLabel, { color: theme.colors.text }]}>{t('quickActions.quickStudy')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="settings-ai-generate"
            onPress={() => navigation.navigate('AIGenerate')}
            style={styles.quickActionItem}
          >
            <View style={[styles.quickActionCircle, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={{ fontSize: 22 }}>{'\uD83E\uDD16'}</Text>
            </View>
            <Text style={[styles.quickActionLabel, { color: theme.colors.text }]}>{t('quickActions.aiGenerate')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="settings-invite-link"
            onPress={() => Share.share({ message: t('quickActions.shareMessage') })}
            style={styles.quickActionItem}
          >
            <View style={[styles.quickActionCircle, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={{ fontSize: 22 }}>{'\uD83D\uDCE7'}</Text>
            </View>
            <Text style={[styles.quickActionLabel, { color: theme.colors.text }]}>{t('quickActions.invite')}</Text>
          </TouchableOpacity>
        </View>

        <GroupLabel theme={theme}>{t('groups.billing')}</GroupLabel>

        {/* AI wallet / usage (충전금·사용량) */}
        <CollapsibleSection title={tWallet('title')} icon="💳">
          <WalletSummary />
        </CollapsibleSection>

        {/* Card storage usage (owned-card limit, mig 116) */}
        {cardUsage && (
          <CollapsibleSection
            title={t('cardUsage.title')}
            icon="📇"
            badge={<Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{cardUsage.limit >= UNLIMITED_CARD_LIMIT ? t('cardUsage.countUnlimited', { owned: cardUsage.owned }) : t('cardUsage.count', { owned: cardUsage.owned, limit: cardUsage.limit })}</Text>}
          >
            {cardUsageDetail ? (
              <CardUsagePanel detail={cardUsageDetail} />
            ) : (
              <View style={{ height: 96, borderRadius: 12, backgroundColor: theme.colors.surface }} />
            )}
            {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 8 }]}>
                {t('cardUsage.cancelPending', {
                  date: new Date(subscription.currentPeriodEnd).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
                })}
              </Text>
            )}
            {/* Data-driven subscription plan selector (mirrors web). Gated behind the
                mobile IAP flag (Apple Guideline 2.1(b)) — NO plan pricing / Select CTA
                may render until store IAP products exist. Inert until the gate flips;
                onSelect routes to the Paywall (also gated) to run the purchase flow.
                The at-cap "reached" state is shown inside <CardUsagePanel/> above. */}
            {SUBSCRIPTION_UI_ENABLED && (
              <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 16 }}>
                <PlanSelector
                  subscription={subscription}
                  onSelect={() => navigation.navigate('Paywall')}
                />
              </View>
            )}
          </CollapsibleSection>
        )}

        {/* ── Templates ── */}
        <SectionCard theme={theme}>
          <TouchableOpacity
            testID="settings-templates-link"
            onPress={() => navigation.navigate('TemplatesList')}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('templates.title')}</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {t('templates.description')}
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
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('shares.title')}</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {t('shares.description')}
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
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('publisher.title')}</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {t('publisher.description')}
              </Text>
            </View>
            <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
          </TouchableOpacity>
        </SectionCard>

        <GroupLabel theme={theme}>{t('groups.study')}</GroupLabel>

        {/* ── Answer Mode — matches web: standalone card ── */}
        <CollapsibleSection title={t('answerMode.title')} icon="📝">
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
                    {mode === 'button' ? t('answerMode.button') : t('answerMode.swipe')}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={styles.segmentRow}>
            {(['before', 'same', 'after'] as const).map((timing) => {
              const isActive = profile.answer_timing === timing
              const labels = { before: t('answerMode.before'), same: t('answerMode.same'), after: t('answerMode.after') }
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
            {t('answerMode.timingDesc')}
          </Text>
        </CollapsibleSection>

        {/* ── New Card Limit — standalone card ── */}
        <CollapsibleSection title={t('newCardLimit.title')} icon="🔢">
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
            {t('newCardLimit.hint')}
          </Text>
        </CollapsibleSection>

        {/* ── Auto TTS Reading — standalone card ── */}
        <CollapsibleSection title={t('tts.title')} icon="🔊">
          <View style={styles.switchRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('tts.enable')}</Text>
            <Switch
              testID="settings-tts-toggle"
              value={profile.tts_enabled}
              onValueChange={(v) => saveProfile({ tts_enabled: v })}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          {profile.tts_enabled && (
            <View style={styles.ttsSettings}>
              <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>{t('tts.voiceEngine')}</Text>
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
                      <Text style={[styles.modeLabel, { color: isActive ? theme.colors.primary : theme.colors.text }]}>{t(prov.labelKey)}</Text>
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>{t(prov.descKey)}</Text>
                      {prov.noteKey ? <Text style={{ fontSize: 11, color: palette.yellow[500], marginTop: 2 }}>{t(prov.noteKey, { ns: 'settings' })}</Text> : null}
                    </TouchableOpacity>
                  )
                })}
              </View>
              <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>{t('tts.readingSpeed')}</Text>
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
        </CollapsibleSection>

        {/* ── Daily Study Goal — standalone like web ── */}
        <CollapsibleSection title={t('dailyGoal.title')} icon="🎯">
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
            placeholder={t('dailyGoal.placeholder')}
          />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {t('dailyGoal.hint')}
          </Text>
        </CollapsibleSection>

        {/* ── d) SRS Configuration ── */}
        <CollapsibleSection title={t('srsConfig.title')} icon="🧠">
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
            {t('srsConfig.description')}
          </Text>
          <View style={styles.sectionBody}>
            <TextInput
              testID="settings-srs-learning-steps"
              label={t('srsConfig.learningSteps')}
              value={learningStepsText}
              onChangeText={setLearningStepsText}
              onBlur={handleSaveLearningSteps}
              placeholder="1, 10"
            />
            <View style={styles.srsRow}>
              <View style={styles.srsField}>
                <TextInput
                  testID="settings-srs-good-interval"
                  label={t('srsConfig.goodInterval')}
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
                  label={t('srsConfig.easyInterval')}
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
        </CollapsibleSection>

        {/* ── Haptic feedback — standalone card ── */}
        <SectionCard theme={theme}>
          <View style={styles.switchRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>
              {t('haptics.enable', { defaultValue: 'Haptic feedback' })}
            </Text>
            <Switch
              testID="settings-haptics-toggle"
              value={hapticsOn}
              onValueChange={(v) => {
                setHapticsOn(v)
                setHapticsEnabled(v)
                localPrefs.setHapticsEnabled(v)
                if (v) haptics.success() // immediate confirmation when turning on
              }}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {t('haptics.hint', { defaultValue: 'Vibration feedback on taps, ratings, and actions.' })}
          </Text>
        </SectionCard>

        <GroupLabel theme={theme}>{t('groups.preferences')}</GroupLabel>

        {/* ── f) Language ── */}
        <CollapsibleSection title={t('language.title')} icon="🌐">
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
                <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{t('language.title')}</Text>
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
        </CollapsibleSection>

        {/* ── Theme ── */}
        <CollapsibleSection title={t('theme.title')} icon="🎨">
          <View style={styles.segmentRow}>
            {(['light', 'dark', 'system'] as const).map((mode) => {
              const isActive = themeMode === mode
              const labels = { light: t('theme.light'), dark: t('theme.dark'), system: t('theme.system') }
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
        </CollapsibleSection>

        {/* ── g) Notifications ── */}
        <CollapsibleSection title={t('notifications.title')} icon="🔔">
          <View style={styles.switchRow}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('notifications.dailyReminder')}</Text>
            <Switch
              testID="settings-notification-toggle"
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{ true: theme.colors.primary }}
            />
          </View>
          {notificationsEnabled && (
            <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
              {t('notifications.reminderDesc')}
            </Text>
          )}
        </CollapsibleSection>

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

        <GroupLabel theme={theme}>{t('groups.data')}</GroupLabel>

        {/* ── i) Export My Data — matches web ── */}
        <CollapsibleSection title={t('export.title')} icon="📥">
          {[
            { key: 'stats', icon: '📊', labelKey: 'export.stats' },
            { key: 'sessions', icon: '📅', labelKey: 'export.sessions' },
            { key: 'decks', icon: '📚', labelKey: 'export.decks' },
            { key: 'cards', icon: '🃏', labelKey: 'export.cards' },
          ].map((item) => (
            <TouchableOpacity
              key={item.key}
              testID={`settings-export-${item.key}`}
              onPress={() => navigation.navigate('ImportExport' as never)}
              style={[styles.exportRow, { borderColor: theme.colors.border }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 18 }}>{item.icon}</Text>
                <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>{t(item.labelKey)}</Text>
              </View>
              <Text style={{ color: theme.colors.textTertiary }}>{'>'}</Text>
            </TouchableOpacity>
          ))}
        </CollapsibleSection>

        {/* ── j) Legal (compact inline links) ── */}
        <View style={styles.legalRow}>
          <TouchableOpacity
            testID="settings-privacy-policy"
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          >
            <Text style={[styles.legalLink, { color: theme.colors.textSecondary }]}>{t('legal.privacyPolicy')}</Text>
          </TouchableOpacity>
          <Text style={[styles.legalDot, { color: theme.colors.textTertiary }]}>·</Text>
          <TouchableOpacity
            testID="settings-terms-of-service"
            onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
          >
            <Text style={[styles.legalLink, { color: theme.colors.textSecondary }]}>{t('legal.termsOfService')}</Text>
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
          <Text style={[styles.logoutText, { color: theme.colors.textSecondary }]}>{t('account.logout')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="settings-delete-account"
          onPress={handleDeleteAccount}
          style={styles.deleteLink}
        >
          <Text style={[styles.deleteLinkText, { color: theme.colors.error }]}>{t('account.deleteAccount')}</Text>
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
 * Category group label — small uppercase heading above a group of sections
 */
function GroupLabel({ children, theme }: { children: React.ReactNode; theme: ReturnType<typeof useTheme> }) {
  return <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: theme.colors.textSecondary, marginTop: 20, marginBottom: 8, marginLeft: 4 }}>{children}</Text>
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
  configBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  aiEditForm: { gap: 10, paddingTop: 10, borderTopWidth: 1 },
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
