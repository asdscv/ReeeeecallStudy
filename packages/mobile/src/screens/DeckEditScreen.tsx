import { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button, ScreenHeader } from '../components/ui'
import { StatCard } from '../components/charts/StatCard'
import { ProgressBar } from '../components/charts/ProgressBar'
import { useDecks } from '../hooks/useDecks'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { ratingColors } from '@reeeeecall/shared/design-tokens/colors'
import { getMobileSupabase } from '../adapters'
import { calculateDeckStats } from '@reeeeecall/shared/lib/stats'
import { DEFAULT_SRS_SETTINGS } from '@reeeeecall/shared/types/database'
import type { SrsSettings, Card } from '@reeeeecall/shared/types/database'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'DeckEdit'>
type Route = RouteProp<DecksStackParamList, 'DeckEdit'>

const COLORS = ['#3B82F6', '#EF4444', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280']
const ICONS = ['📚', '📖', '🇨🇳', '🇺🇸', '🇯🇵', '🧠', '💡', '📝']

/** SRS field definitions with colored labels matching web */
const SRS_INTERVAL_FIELDS: { key: keyof SrsSettings; label: string; color: string }[] = [
  { key: 'again_days', label: 'Again', color: ratingColors.again },
  { key: 'hard_days', label: 'Hard', color: ratingColors.hard },
  { key: 'good_days', label: 'Good', color: ratingColors.good },
  { key: 'easy_days', label: 'Easy', color: ratingColors.easy },
]

export function DeckEditScreen() {
  const theme = useTheme()
  const { t } = useTranslation('decks')
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const deckId = route.params?.deckId

  const { decks, templates, createDeck, updateDeck } = useDecks()
  const existingDeck = deckId ? decks.find((d) => d.id === deckId) : null
  const isEditing = !!existingDeck

  const [name, setName] = useState(existingDeck?.name ?? '')
  const [description, setDescription] = useState(existingDeck?.description ?? '')
  const [color, setColor] = useState(existingDeck?.color ?? COLORS[0])
  const [icon, setIcon] = useState(existingDeck?.icon ?? ICONS[0])
  const [templateId, setTemplateId] = useState(existingDeck?.default_template_id ?? '')
  const [saving, setSaving] = useState(false)

  // SRS Settings
  const existingSrs = (existingDeck as any)?.srs_settings as SrsSettings | undefined
  const [srsSettings, setSrsSettings] = useState<SrsSettings>(existingSrs ?? { ...DEFAULT_SRS_SETTINGS })
  const [learningStepsText, setLearningStepsText] = useState(
    (existingSrs?.learning_steps ?? DEFAULT_SRS_SETTINGS.learning_steps ?? [1, 10]).join(', ')
  )

  // Statistics (edit mode only)
  const [cards, setCards] = useState<Card[]>([])

  // Auto-select first template
  useEffect(() => {
    if (!templateId && templates.length > 0) {
      const defaultTpl = templates.find((t) => t.is_default) ?? templates[0]
      setTemplateId(defaultTpl.id)
    }
  }, [templates, templateId])

  // Load cards for stats panel (edit mode only)
  useEffect(() => {
    if (!deckId) return
    const supabase = getMobileSupabase()
    supabase
      .from('cards')
      .select('*')
      .eq('deck_id', deckId)
      .then(({ data }) => {
        if (data) setCards(data as Card[])
      })
  }, [deckId])

  const parseLearningSteps = (text: string): number[] => {
    return text
      .split(',')
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n) && n > 0 && n <= 1440)
  }

  const updateSrsField = (key: keyof SrsSettings, value: number) => {
    setSrsSettings((prev) => ({ ...prev, [key]: Math.max(0, Math.min(365, value)) }))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert(t('edit.nameRequired'), t('edit.nameRequired'))
      return
    }

    // Parse learning steps from text
    const steps = parseLearningSteps(learningStepsText)
    const finalSrs: SrsSettings = {
      ...srsSettings,
      learning_steps: steps.length > 0 ? steps : [1, 10],
    }

    setSaving(true)
    try {
      if (isEditing && deckId) {
        await updateDeck(deckId, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          default_template_id: templateId || null,
          srs_settings: finalSrs,
        })
      } else {
        await createDeck({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          icon,
          default_template_id: templateId || undefined,
          srs_settings: finalSrs,
        })
      }
      navigation.goBack()
    } catch (e) {
      Alert.alert(t('edit.saveFailed'), t('edit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // Stats computed values (edit mode only)
  const deckStats = cards.length > 0 ? calculateDeckStats(cards) : null

  return (
    <Screen scroll keyboard testID="deck-edit-screen">
      <ScreenHeader title={isEditing ? t('edit.title') : t('edit.createTitle')} mode="back" />
      <View style={styles.content}>

        {/* Preview */}
        <View style={[styles.preview, { backgroundColor: color + '15', borderColor: color + '40' }]}>
          <Text style={styles.previewIcon}>{icon}</Text>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{name || 'Deck Name'}</Text>
        </View>

        {/* Form */}
        <TextInput
          testID="deck-edit-name"
          label={t('edit.deckName')}
          placeholder={t('edit.namePlaceholder')}
          value={name}
          onChangeText={setName}
          autoFocus={!isEditing}
        />

        <TextInput
          testID="deck-edit-description"
          label={t('edit.description')}
          placeholder={t('edit.descriptionPlaceholder')}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />

        {/* Color picker */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('edit.color')}</Text>
          <View style={styles.optionRow}>
            {COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setColor(c)}
                style={[styles.colorDot, { backgroundColor: c }, color === c && styles.selectedDot]}
                testID={`deck-edit-color-${c}`}
              />
            ))}
          </View>
        </View>

        {/* Icon picker */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('edit.icon')}</Text>
          <View style={styles.optionRow}>
            {ICONS.map((i) => (
              <TouchableOpacity
                key={i}
                onPress={() => setIcon(i)}
                style={[styles.iconBtn, { backgroundColor: theme.colors.surface }, icon === i && { borderColor: theme.colors.primary, borderWidth: 2 }]}
                testID={`deck-edit-icon-${i}`}
              >
                <Text style={styles.iconText}>{i}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Template selector */}
        {templates.length > 0 && (
          <View style={styles.section}>
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('edit.template')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.optionRow}>
                {templates.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => setTemplateId(t.id)}
                    style={[
                      styles.templateChip,
                      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                      templateId === t.id && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
                    ]}
                    testID={`deck-edit-template-${t.id}`}
                  >
                    <Text style={[
                      theme.typography.bodySmall,
                      { color: templateId === t.id ? theme.colors.primary : theme.colors.text },
                    ]}>
                      {t.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* ── SRS Settings ── */}
        <View style={[styles.srsCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>SRS Settings</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            Configure spaced repetition intervals for this deck.
          </Text>

          {/* Learning Steps */}
          <TextInput
            testID="deck-edit-srs-learning-steps"
            label="Learning Steps (minutes)"
            value={learningStepsText}
            onChangeText={setLearningStepsText}
            placeholder="1, 10"
          />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Comma-separated minutes, e.g. "1, 10" for 1min then 10min steps.
          </Text>

          {/* Interval fields — 2x2 grid with colored labels */}
          <View style={styles.srsGrid}>
            {SRS_INTERVAL_FIELDS.map(({ key, label, color: labelColor }) => (
              <View key={key} style={styles.srsGridItem}>
                <Text style={[styles.srsLabel, { color: labelColor }]}>{label}</Text>
                <TextInput
                  testID={`deck-edit-srs-${key}`}
                  value={String(srsSettings[key] as number)}
                  onChangeText={(v) => updateSrsField(key, parseInt(v) || 0)}
                  keyboardType="number-pad"
                  placeholder="0"
                />
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>days</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Statistics Panel (edit mode only) ── */}
        {isEditing && deckStats && (
          <View style={[styles.statsCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <View style={styles.statsBodyAlways}>
              <Text style={[theme.typography.label, { color: theme.colors.text }]}>Statistics</Text>

              {/* Summary row */}
              <View style={styles.statsRow}>
                <StatCard label="Total Cards" value={deckStats.totalCards} testID="deck-edit-stat-total" />
                <StatCard label="Mastery" value={`${deckStats.masteryRate}%`} testID="deck-edit-stat-mastery" />
              </View>

              {/* SRS status distribution bar */}
              {deckStats.totalCards > 0 && (() => {
                const masteredCount = deckStats.totalCards - deckStats.newCount - deckStats.learningCount - deckStats.reviewCount
                const segments = [
                  { label: 'New', count: deckStats.newCount, color: palette.blue[500] },
                  { label: 'Learning', count: deckStats.learningCount, color: palette.yellow[500] },
                  { label: 'Review', count: deckStats.reviewCount, color: palette.green[500] },
                  { label: 'Mastered', count: masteredCount, color: palette.gray[400] },
                ]
                return (
                  <View style={[styles.statusCard, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginBottom: 6 }]}>
                      Card Status Distribution
                    </Text>
                    <View style={styles.distributionBar}>
                      {segments.map((s, idx) => {
                        const pct = (s.count / deckStats.totalCards) * 100
                        if (pct === 0) return null
                        return (
                          <View
                            key={idx}
                            style={{ width: `${pct}%` as any, height: '100%', backgroundColor: s.color }}
                          />
                        )
                      })}
                    </View>
                    <View style={styles.badgeRow}>
                      {segments.map((s, idx) => (
                        <View key={idx} style={styles.legendItem}>
                          <View style={[styles.badgeDot, { backgroundColor: s.color }]} />
                          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                            {s.label}: {s.count}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )
              })()}

              {/* Additional stats */}
              <View style={styles.statsRow}>
                <StatCard label="Avg Interval" value={`${deckStats.avgInterval.toFixed(1)}d`} testID="deck-edit-stat-interval" />
                <StatCard label="Avg Ease" value={deckStats.avgEase.toFixed(2)} testID="deck-edit-stat-ease" />
              </View>

              {/* Mastery bar */}
              <ProgressBar percentage={deckStats.masteryRate} label="Mastery Rate" testID="deck-edit-mastery-bar" />
            </View>
          </View>
        )}

        <Button
          testID="deck-edit-save"
          title={isEditing ? t('edit.save') : t('edit.create')}
          onPress={handleSave}
          loading={saving}
          disabled={!name.trim()}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },

  preview: { alignItems: 'center', padding: 20, borderRadius: 16, borderWidth: 1, gap: 8 },
  previewIcon: { fontSize: 40 },
  section: { gap: 8 },
  optionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  selectedDot: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  iconText: { fontSize: 22 },
  templateChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  // SRS Settings card
  srsCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 10 },
  srsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  srsGridItem: { width: '47%' as any, gap: 2 },
  srsLabel: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  // Statistics card
  statsCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  statsBodyAlways: { padding: 16, gap: 12 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statusCard: { borderRadius: 10, padding: 12, gap: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  distributionBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 4 },
})
