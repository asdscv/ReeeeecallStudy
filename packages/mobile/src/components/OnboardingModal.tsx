import { useState, useCallback, useEffect } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet, Dimensions, ScrollView, ActivityIndicator } from 'react-native'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { getMobileSupabase } from '../adapters'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import { fetchStarterDecks } from '@reeeeecall/shared/lib/starter-decks'
import type { MarketplaceListing } from '@reeeeecall/shared/types/database'
import type { MainTabParamList } from '../navigation/types'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const STEPS = [
  { key: 'welcome', icon: '🎉' },
  // Something studiable before any authoring chore — a new account owns nothing, and
  // asking it to build a deck first is where most of them left.
  { key: 'quickStart', icon: '⚡' },
  { key: 'createDeck', icon: '📚' },
  { key: 'cardTemplate', icon: '📋' },
  { key: 'addCards', icon: '✏️' },
  { key: 'firstStudy', icon: '🧠' },
  { key: 'exploreMarket', icon: '🏪' },
] as const

interface OnboardingModalProps {
  visible: boolean
  onDismiss: () => void
}

export function OnboardingModal({ visible, onDismiss }: OnboardingModalProps) {
  const theme = useTheme()
  const { t, i18n } = useTranslation('common')
  const navigation = useNavigation<NavigationProp<MainTabParamList>>()
  const acquireDeck = useMarketplaceStore((s) => s.acquireDeck)
  const [step, setStep] = useState(0)
  const [starters, setStarters] = useState<MarketplaceListing[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pickFailed, setPickFailed] = useState(false)

  const current = STEPS[step]

  // Load once the step is actually reachable, not on mount — most sessions never
  // open this modal at all.
  useEffect(() => {
    if (current.key !== 'quickStart' || starters !== null) return
    let alive = true
    fetchStarterDecks(getMobileSupabase(), i18n.language, 3)
      .then((d) => { if (alive) setStarters(d) })
      .catch(() => { if (alive) setStarters([]) })
    return () => { alive = false }
  }, [current.key, starters, i18n.language])

  const handlePickStarter = useCallback(async (listingId: string) => {
    setBusyId(listingId)
    setPickFailed(false)
    const result = await acquireDeck(listingId)
    if (!result) {
      // Acquire can legitimately refuse (card-ownership limit). Leave them a way on
      // rather than a dead row.
      setBusyId(null)
      setPickFailed(true)
      return
    }
    Promise.resolve(getMobileSupabase().rpc('complete_onboarding_step', { p_step_key: 'quickStart' })).catch(() => {})
    onDismiss()
    navigation.navigate('StudyTab', { screen: 'StudySetup', params: { deckId: result.deckId } } as never)
  }, [acquireDeck, onDismiss, navigation])

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    }
  }, [step])

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep(step - 1)
    }
  }, [step])

  const handleAction = useCallback(() => {
    const stepKey = current.key
    // Complete step in DB
    Promise.resolve(getMobileSupabase().rpc('complete_onboarding_step', { p_step_key: stepKey })).catch(() => {})

    switch (stepKey) {
      case 'welcome':
        handleNext()
        break
      case 'quickStart':
        // The deck rows are the real CTA; this button is the opt-out into authoring.
        handleNext()
        break
      case 'createDeck':
        onDismiss()
        navigation.navigate('DecksTab' as never)
        break
      case 'cardTemplate':
        handleNext()
        break
      case 'addCards':
        onDismiss()
        navigation.navigate('DecksTab' as never)
        break
      case 'firstStudy':
        onDismiss()
        navigation.navigate('StudyTab' as never)
        break
      case 'exploreMarket':
        onDismiss()
        Promise.resolve(getMobileSupabase().rpc('skip_onboarding')).catch(() => {})
        navigation.navigate('MarketTab' as never)
        break
    }
  }, [current, step, onDismiss, navigation, handleNext])

  const handleSkip = useCallback(async () => {
    try {
      await getMobileSupabase().rpc('skip_onboarding')
    } catch { /* ignore */ }
    onDismiss()
  }, [onDismiss])

  const isLast = step === STEPS.length - 1

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleSkip}
    >
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated }]}>
          {/* Skip button */}
          <TouchableOpacity
            onPress={handleSkip}
            style={styles.skipButton}
            testID="onboarding-skip"
          >
            <Text style={[styles.skipText, { color: theme.colors.textSecondary }]}>
              {t('onboarding.skip', 'Skip')}
            </Text>
          </TouchableOpacity>

          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBg, { backgroundColor: theme.colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: palette.blue[500],
                    width: `${((step + 1) / STEPS.length) * 100}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
              {t('onboarding.stepOf', '{{current}} / {{total}}', {
                current: step + 1,
                total: STEPS.length,
              })}
            </Text>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Icon */}
            <Text style={styles.icon}>{current.icon}</Text>

            {/* Title */}
            <Text style={[styles.title, { color: theme.colors.text}]}>
              {t(`onboarding.${current.key}.title`, current.key)}
            </Text>

            {/* Description */}
            <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
              {t(`onboarding.${current.key}.description`, '')}
            </Text>

            {/* Ready-made decks — one tap to a first card */}
            {current.key === 'quickStart' && (
              <View style={styles.starterList} testID="onboarding-starters">
                {starters === null && (
                  <ActivityIndicator color={palette.blue[500]} style={styles.starterSpinner} />
                )}

                {starters !== null && starters.length === 0 && (
                  <Text style={[styles.starterEmpty, { color: theme.colors.textSecondary }]}>
                    {t('onboarding.quickStart.empty', '')}
                  </Text>
                )}

                {starters?.map((deck) => (
                  <TouchableOpacity
                    key={deck.id}
                    onPress={() => handlePickStarter(deck.id)}
                    disabled={busyId !== null}
                    testID={`onboarding-starter-${deck.id}`}
                    style={[
                      styles.starterRow,
                      { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                      busyId !== null && styles.starterRowDisabled,
                    ]}
                  >
                    <View style={styles.starterTextCol}>
                      <Text style={[styles.starterTitle, { color: theme.colors.text }]} numberOfLines={2}>
                        {deck.title}
                      </Text>
                      <Text style={[styles.starterMeta, { color: theme.colors.textSecondary }]}>
                        {t('onboarding.quickStart.cardCount', { count: deck.card_count })}
                      </Text>
                    </View>
                    {busyId === deck.id && <ActivityIndicator color={palette.blue[500]} />}
                  </TouchableOpacity>
                ))}

                {pickFailed && (
                  <Text style={[styles.starterEmpty, { color: theme.colors.error }]} testID="onboarding-starter-error">
                    {t('onboarding.quickStart.failed', '')}
                  </Text>
                )}
              </View>
            )}
          </ScrollView>

          {/* Action buttons */}
          <View style={styles.actions}>
            {step > 0 && (
              <TouchableOpacity
                onPress={handleBack}
                style={[styles.backButton, { borderColor: theme.colors.border }]}
              >
                <Text style={[styles.backButtonText, { color: theme.colors.text}]}>
                  {t('onboarding.back', 'Back')}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={isLast ? handleAction : handleAction}
              style={[styles.actionButton, { backgroundColor: palette.blue[500] }, step === 0 && styles.actionButtonFull]}
              testID="onboarding-action"
            >
              <Text style={styles.actionButtonText}>
                {isLast
                  ? t('onboarding.finish', 'Finish')
                  : t(`onboarding.${current.key}.action`, 'Next')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Step dots */}
          <View style={styles.dots}>
            {STEPS.map((s, i) => (
              <View
                key={s.key}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === step ? palette.blue[500] : theme.colors.border,
                    width: i === step ? 20 : 8,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  starterList: {
    width: '100%',
    marginTop: 8,
    gap: 10,
  },
  starterSpinner: {
    marginVertical: 20,
  },
  starterEmpty: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 12,
  },
  starterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  starterRowDisabled: {
    opacity: 0.6,
  },
  starterTextCol: {
    flex: 1,
  },
  starterTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  starterMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 20,
    padding: 24,
    width: Math.min(SCREEN_WIDTH - 48, 400),
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  skipButton: {
    alignSelf: 'flex-end',
    padding: 4,
  },
  skipText: {
    fontSize: 14,
  },
  progressContainer: {
    marginTop: 8,
    marginBottom: 16,
  },
  progressBg: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },
  content: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  icon: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  backButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonFull: {
    flex: 1,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
})
