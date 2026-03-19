import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, TextInput, Button } from '../components/ui'
import { useTheme, palette } from '../theme'
import { useTemplateStore } from '@reeeeecall/shared/stores/template-store'
import type { TemplateField, LayoutItem } from '@reeeeecall/shared/types/database'
import type { SettingsStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'TemplateEdit'>
type Route = RouteProp<SettingsStackParamList, 'TemplateEdit'>

const STYLE_OPTIONS: { value: LayoutItem['style']; label: string }[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'hint', label: 'Hint' },
  { value: 'detail', label: 'Detail' },
  { value: 'media', label: 'Media' },
]

function generateKey(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function TemplateEditScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const route = useRoute<Route>()
  const templateId = route.params?.templateId

  const { templates, fetchTemplates, createTemplate, updateTemplate } = useTemplateStore()

  const isNew = !templateId
  const template = templates.find((t) => t.id === templateId)

  const [name, setName] = useState('')
  const [fields, setFields] = useState<TemplateField[]>([])
  const [frontLayout, setFrontLayout] = useState<LayoutItem[]>([])
  const [backLayout, setBackLayout] = useState<LayoutItem[]>([])
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    setLoaded(false)
  }, [templateId])

  useEffect(() => {
    if (loaded) return
    if (isNew) {
      setName('')
      setFields([
        { key: 'front', name: 'Front', type: 'text', order: 0 },
        { key: 'back', name: 'Back', type: 'text', order: 1 },
      ])
      setFrontLayout([{ field_key: 'front', style: 'primary' }])
      setBackLayout([{ field_key: 'back', style: 'primary' }])
      setLoaded(true)
    } else if (template) {
      setName(template.name)
      setFields([...template.fields])
      setFrontLayout([...template.front_layout])
      setBackLayout([...template.back_layout])
      setLoaded(true)
    }
  }, [isNew, template, loaded])

  // ── Field management ──

  const addField = () => {
    if (fields.length >= 10) return
    const newField: TemplateField = {
      key: generateKey(),
      name: `Field ${fields.length + 1}`,
      type: 'text',
      order: fields.length,
    }
    setFields([...fields, newField])
  }

  const updateField = (index: number, updates: Partial<TemplateField>) => {
    const next = [...fields]
    next[index] = { ...next[index], ...updates }
    setFields(next)
  }

  const removeField = (index: number) => {
    if (fields.length <= 1) return
    const removed = fields[index]
    Alert.alert(
      'Remove Field',
      `Remove "${removed.name}"? This will also remove it from front/back layouts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const next = fields.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i }))
            setFields(next)
            setFrontLayout((prev) => prev.filter((l) => l.field_key !== removed.key))
            setBackLayout((prev) => prev.filter((l) => l.field_key !== removed.key))
          },
        },
      ],
    )
  }

  const moveField = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= fields.length) return
    const next = [...fields]
    const temp = next[index]
    next[index] = next[newIndex]
    next[newIndex] = temp
    next.forEach((f, i) => (f.order = i))
    setFields(next)
  }

  // ── Layout management ──

  const addLayoutField = (side: 'front' | 'back', fieldKey: string) => {
    if (side === 'front') {
      if (frontLayout.some((l) => l.field_key === fieldKey)) return
      setFrontLayout([...frontLayout, { field_key: fieldKey, style: 'primary' }])
    } else {
      if (backLayout.some((l) => l.field_key === fieldKey)) return
      setBackLayout([...backLayout, { field_key: fieldKey, style: 'primary' }])
    }
  }

  const removeLayoutField = (side: 'front' | 'back', fieldKey: string) => {
    if (side === 'front') {
      setFrontLayout(frontLayout.filter((l) => l.field_key !== fieldKey))
    } else {
      setBackLayout(backLayout.filter((l) => l.field_key !== fieldKey))
    }
  }

  const updateLayoutStyle = (side: 'front' | 'back', fieldKey: string, style: LayoutItem['style']) => {
    if (side === 'front') {
      setFrontLayout(frontLayout.map((l) => (l.field_key === fieldKey ? { ...l, style } : l)))
    } else {
      setBackLayout(backLayout.map((l) => (l.field_key === fieldKey ? { ...l, style } : l)))
    }
  }

  const getFieldName = useCallback(
    (fieldKey: string) => fields.find((f) => f.key === fieldKey)?.name ?? fieldKey,
    [fields],
  )

  // ── Save ──

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Template name is required')
      return
    }
    if (fields.length === 0) {
      Alert.alert('Error', 'At least one field is required')
      return
    }

    setSaving(true)
    try {
      if (isNew) {
        const created = await createTemplate({
          name: name.trim(),
          fields,
          front_layout: frontLayout,
          back_layout: backLayout,
        })
        if (created) {
          navigation.goBack()
        } else {
          Alert.alert('Error', 'Failed to create template')
        }
      } else {
        const success = await updateTemplate(templateId!, {
          name: name.trim(),
          fields,
          front_layout: frontLayout,
          back_layout: backLayout,
        })
        if (success) {
          navigation.goBack()
        } else {
          Alert.alert('Error', 'Failed to save template')
        }
      }
    } catch {
      Alert.alert('Error', 'An unexpected error occurred')
    } finally {
      setSaving(false)
    }
  }

  // Loading state
  if (!isNew && !template && templates.length > 0) {
    return (
      <Screen scroll keyboard testID="template-edit-screen">
        <View style={styles.centered}>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            Template not found
          </Text>
          <Button title="Back to List" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    )
  }

  if (!loaded) {
    return (
      <Screen testID="template-edit-screen">
        <View style={styles.centered}>
          <Text style={[theme.typography.h3, { color: theme.colors.textSecondary }]}>Loading...</Text>
        </View>
      </Screen>
    )
  }

  const availableFrontFields = fields.filter((f) => !frontLayout.some((l) => l.field_key === f.key))
  const availableBackFields = fields.filter((f) => !backLayout.some((l) => l.field_key === f.key))

  return (
    <Screen safeArea padding={false} testID="template-edit-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.topRow}>
          <Button
            title="Cancel"
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => navigation.goBack()}
            testID="template-edit-cancel"
          />
          <Button
            title={saving ? 'Saving...' : 'Save'}
            variant="primary"
            size="sm"
            fullWidth={false}
            loading={saving}
            disabled={!name.trim()}
            onPress={handleSave}
            testID="template-edit-save"
          />
        </View>

        <Text style={[theme.typography.h2, { color: theme.colors.text }]}>
          {isNew ? 'New Template' : 'Edit Template'}
        </Text>

        {/* Template name */}
        <TextInput
          testID="template-edit-name"
          label="Template Name"
          placeholder="e.g. Language Card"
          value={name}
          onChangeText={setName}
          autoFocus={isNew}
        />

        {/* ── Field Management ── */}
        <SectionCard theme={theme} title="Fields" subtitle={`${fields.length} / 10`}>
          {fields.map((field, i) => (
            <View
              key={field.key}
              style={[styles.fieldRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <View style={styles.fieldHeader}>
                <Text style={[styles.fieldNumber, { color: theme.colors.textTertiary }]}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <TextInput
                    testID={`template-field-name-${i}`}
                    value={field.name}
                    onChangeText={(v) => updateField(i, { name: v })}
                    placeholder="Field name"
                  />
                </View>
              </View>

              {/* Field description */}
              <TextInput
                testID={`template-field-detail-${i}`}
                value={field.detail || ''}
                onChangeText={(v) => updateField(i, { detail: v || undefined })}
                placeholder="Field description (optional)"
              />

              {/* Field actions */}
              <View style={styles.fieldActions}>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                  Type: {field.type}
                </Text>
                <View style={styles.fieldBtnGroup}>
                  {i > 0 && (
                    <TouchableOpacity
                      testID={`template-field-up-${i}`}
                      onPress={() => moveField(i, 'up')}
                      style={[styles.fieldBtn, { backgroundColor: theme.colors.surface }]}
                    >
                      <Text style={[theme.typography.caption, { color: theme.colors.text }]}>Up</Text>
                    </TouchableOpacity>
                  )}
                  {i < fields.length - 1 && (
                    <TouchableOpacity
                      testID={`template-field-down-${i}`}
                      onPress={() => moveField(i, 'down')}
                      style={[styles.fieldBtn, { backgroundColor: theme.colors.surface }]}
                    >
                      <Text style={[theme.typography.caption, { color: theme.colors.text }]}>Down</Text>
                    </TouchableOpacity>
                  )}
                  {fields.length > 1 && (
                    <TouchableOpacity
                      testID={`template-field-remove-${i}`}
                      onPress={() => removeField(i)}
                      style={[styles.fieldBtn, { backgroundColor: palette.red[50] }]}
                    >
                      <Text style={[theme.typography.caption, { color: palette.red[600] }]}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          ))}

          {fields.length < 10 && (
            <TouchableOpacity
              testID="template-add-field"
              onPress={addField}
              style={[styles.addFieldBtn, { borderColor: theme.colors.border }]}
            >
              <Text style={[theme.typography.body, { color: theme.colors.primary }]}>+ Add Field</Text>
            </TouchableOpacity>
          )}
        </SectionCard>

        {/* ── Front Layout ── */}
        <LayoutSection
          theme={theme}
          title="Front Layout"
          layout={frontLayout}
          availableFields={availableFrontFields}
          getFieldName={getFieldName}
          onAdd={(key) => addLayoutField('front', key)}
          onRemove={(key) => removeLayoutField('front', key)}
          onStyleChange={(key, style) => updateLayoutStyle('front', key, style)}
          side="front"
        />

        {/* ── Back Layout ── */}
        <LayoutSection
          theme={theme}
          title="Back Layout"
          layout={backLayout}
          availableFields={availableBackFields}
          getFieldName={getFieldName}
          onAdd={(key) => addLayoutField('back', key)}
          onRemove={(key) => removeLayoutField('back', key)}
          onStyleChange={(key, style) => updateLayoutStyle('back', key, style)}
          side="back"
        />

        {/* Save button (bottom) */}
        <Button
          testID="template-edit-save-bottom"
          title={saving ? 'Saving...' : (isNew ? 'Create Template' : 'Save Changes')}
          onPress={handleSave}
          loading={saving}
          disabled={!name.trim()}
        />

        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  )
}

// ── Section Card ──

function SectionCard({
  theme,
  title,
  subtitle,
  children,
}: {
  theme: ReturnType<typeof useTheme>
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <View style={[styles.sectionCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{subtitle}</Text>
        )}
      </View>
      {children}
    </View>
  )
}

// ── Layout Section ──

function LayoutSection({
  theme,
  title,
  layout,
  availableFields,
  getFieldName,
  onAdd,
  onRemove,
  onStyleChange,
  side,
}: {
  theme: ReturnType<typeof useTheme>
  title: string
  layout: LayoutItem[]
  availableFields: TemplateField[]
  getFieldName: (key: string) => string
  onAdd: (fieldKey: string) => void
  onRemove: (fieldKey: string) => void
  onStyleChange: (fieldKey: string, style: LayoutItem['style']) => void
  side: 'front' | 'back'
}) {
  const [showFieldPicker, setShowFieldPicker] = useState(false)

  return (
    <View style={[styles.sectionCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>

      {layout.length === 0 && (
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textTertiary }]}>
          No fields assigned. Add fields to this layout.
        </Text>
      )}

      {layout.map((item) => (
        <View
          key={item.field_key}
          style={[styles.layoutItem, { backgroundColor: palette.green[50], borderColor: '#BBF7D0' }]}
        >
          <Text
            style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]}
            numberOfLines={1}
          >
            {getFieldName(item.field_key)}
          </Text>

          {/* Style selector */}
          <View style={styles.styleSelector}>
            {STYLE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                testID={`template-layout-${side}-${item.field_key}-style-${opt.value}`}
                onPress={() => onStyleChange(item.field_key, opt.value)}
                style={[
                  styles.styleChip,
                  {
                    backgroundColor: item.style === opt.value ? theme.colors.primary : theme.colors.surface,
                  },
                ]}
              >
                <Text
                  style={[
                    theme.typography.caption,
                    { color: item.style === opt.value ? theme.colors.primaryText : theme.colors.textSecondary, fontSize: 10 },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            testID={`template-layout-${side}-remove-${item.field_key}`}
            onPress={() => onRemove(item.field_key)}
            style={[styles.fieldBtn, { backgroundColor: palette.red[50] }]}
          >
            <Text style={[theme.typography.caption, { color: palette.red[600] }]}>X</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Add field to layout */}
      {availableFields.length > 0 && (
        <View>
          <TouchableOpacity
            testID={`template-layout-${side}-add`}
            onPress={() => setShowFieldPicker(!showFieldPicker)}
            style={styles.addLayoutBtn}
          >
            <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
              + Add Field
            </Text>
          </TouchableOpacity>
          {showFieldPicker && (
            <View style={styles.fieldPickerList}>
              {availableFields.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  testID={`template-layout-${side}-pick-${f.key}`}
                  onPress={() => {
                    onAdd(f.key)
                    setShowFieldPicker(false)
                  }}
                  style={[styles.fieldPickerItem, { backgroundColor: theme.colors.surface }]}
                >
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]}>
                    {f.name}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    ({f.type})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 16, paddingTop: 8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60 },
  // Section card
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 17, fontWeight: '600' },
  // Fields
  fieldRow: { borderRadius: 10, borderWidth: 1, padding: 12, gap: 8 },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldNumber: { fontSize: 12, fontFamily: 'monospace', width: 20, textAlign: 'center' },
  fieldActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldBtnGroup: { flexDirection: 'row', gap: 6 },
  fieldBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  addFieldBtn: {
    paddingVertical: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 10,
    alignItems: 'center',
  },
  // Layout
  layoutItem: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  styleSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  styleChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  addLayoutBtn: { paddingVertical: 8 },
  fieldPickerList: { gap: 4, paddingTop: 4 },
  fieldPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
})
