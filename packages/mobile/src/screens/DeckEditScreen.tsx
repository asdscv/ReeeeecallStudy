import { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button } from '../components/ui'
import { useDecks } from '../hooks/useDecks'
import { useTheme } from '../theme'
import type { DecksStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<DecksStackParamList, 'DeckEdit'>
type Route = RouteProp<DecksStackParamList, 'DeckEdit'>

const COLORS = ['#3B82F6', '#EF4444', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#6B7280']
const ICONS = ['📚', '🧠', '🌍', '💼', '🔬', '🎵', '📐', '🏥']

export function DeckEditScreen() {
  const theme = useTheme()
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

  // Auto-select first template
  useEffect(() => {
    if (!templateId && templates.length > 0) {
      const defaultTpl = templates.find((t) => t.is_default) ?? templates[0]
      setTemplateId(defaultTpl.id)
    }
  }, [templates, templateId])

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Deck name is required')
      return
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
        })
      } else {
        await createDeck({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          icon,
          default_template_id: templateId || undefined,
        })
      }
      navigation.goBack()
    } catch (e) {
      Alert.alert('Error', 'Failed to save deck')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen scroll keyboard testID="deck-edit-screen">
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Button title="← Cancel" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />
        </View>

        <Text style={[theme.typography.h2, { color: theme.colors.text }]}>
          {isEditing ? 'Edit Deck' : 'New Deck'}
        </Text>

        {/* Preview */}
        <View style={[styles.preview, { backgroundColor: color + '15', borderColor: color + '40' }]}>
          <Text style={styles.previewIcon}>{icon}</Text>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{name || 'Deck Name'}</Text>
        </View>

        {/* Form */}
        <TextInput
          testID="deck-edit-name"
          label="Name"
          placeholder="e.g. Spanish Vocabulary"
          value={name}
          onChangeText={setName}
          autoFocus={!isEditing}
        />

        <TextInput
          testID="deck-edit-description"
          label="Description"
          placeholder="What will you learn?"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />

        {/* Color picker */}
        <View style={styles.section}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Color</Text>
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
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>Icon</Text>
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
            <Text style={[theme.typography.label, { color: theme.colors.text }]}>Template</Text>
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

        <Button
          testID="deck-edit-save"
          title={isEditing ? 'Save Changes' : 'Create Deck'}
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
  topRow: { flexDirection: 'row' },
  preview: { alignItems: 'center', padding: 20, borderRadius: 16, borderWidth: 1, gap: 8 },
  previewIcon: { fontSize: 40 },
  section: { gap: 8 },
  optionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  colorDot: { width: 36, height: 36, borderRadius: 18 },
  selectedDot: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  iconText: { fontSize: 22 },
  templateChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
})
