import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, Badge, ListCard } from '../components/ui'
import { useTheme, palette } from '../theme'
import { useTemplateStore } from '@reeeeecall/shared/stores/template-store'
import type { CardTemplate } from '@reeeeecall/shared/types/database'
import type { SettingsStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'TemplatesList'>

export function TemplatesListScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const { templates, loading, error, fetchTemplates, deleteTemplate, duplicateTemplate } = useTemplateStore()

  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchTemplates()
    setRefreshing(false)
  }, [fetchTemplates])

  const handleEdit = (template: CardTemplate) => {
    navigation.navigate('TemplateEdit', { templateId: template.id })
  }

  const handleNew = () => {
    navigation.navigate('TemplateEdit', { templateId: undefined })
  }

  const handleDelete = (template: CardTemplate) => {
    if (template.is_default) {
      Alert.alert('Cannot Delete', 'Default templates cannot be deleted.')
      return
    }
    Alert.alert(
      'Delete Template',
      `Are you sure you want to delete "${template.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(template.id)
            const success = await deleteTemplate(template.id)
            if (!success) {
              const storeError = useTemplateStore.getState().error
              Alert.alert('Error', storeError ?? 'Failed to delete template')
            }
            setDeletingId(null)
          },
        },
      ],
    )
  }

  const handleDuplicate = async (template: CardTemplate) => {
    await duplicateTemplate(template.id)
  }

  const renderTemplate = ({ item }: { item: CardTemplate }) => (
    <ListCard testID={`template-card-${item.id}`} onPress={() => handleEdit(item)}>
      <View style={styles.cardContent}>
        {/* Header: name + default badge */}
        <View style={styles.cardHeader}>
          <Text
            style={[theme.typography.label, { color: theme.colors.text, flex: 1 }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.is_default && (
            <Badge label="Default" variant="primary" testID={`template-default-badge-${item.id}`} />
          )}
        </View>

        {/* Fields summary */}
        <View style={styles.fieldsRow}>
          {item.fields.map((field) => (
            <View
              key={field.key}
              style={[styles.fieldChip, { backgroundColor: theme.colors.surface }]}
            >
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {field.type === 'image' ? 'img' : field.type === 'audio' ? 'audio' : 'txt'}{' '}
                {field.name}
              </Text>
            </View>
          ))}
        </View>

        {/* Meta: field count, front/back layout counts */}
        <View style={styles.metaRow}>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            {item.fields.length} fields
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Front: {item.front_layout.length}
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            Back: {item.back_layout.length}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={[styles.actionsRow, { borderTopColor: theme.colors.border }]}>
          <TouchableOpacity
            testID={`template-edit-${item.id}`}
            onPress={() => handleEdit(item)}
            style={[styles.actionBtn, { backgroundColor: theme.colors.surface }]}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`template-duplicate-${item.id}`}
            onPress={() => handleDuplicate(item)}
            style={[styles.actionBtn, { backgroundColor: theme.colors.surface }]}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.text }]}>Duplicate</Text>
          </TouchableOpacity>
          {!item.is_default && (
            <TouchableOpacity
              testID={`template-delete-${item.id}`}
              onPress={() => handleDelete(item)}
              disabled={deletingId === item.id}
              style={[styles.actionBtn, { backgroundColor: palette.red[50], marginLeft: 'auto' }]}
            >
              <Text style={[theme.typography.caption, { color: palette.red[600] }]}>
                {deletingId === item.id ? '...' : 'Delete'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ListCard>
  )

  return (
    <Screen safeArea padding={false} testID="templates-list-screen">
      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        renderItem={renderTemplate}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                {'<-'} Back
              </Text>
            </TouchableOpacity>
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[theme.typography.h2, { color: theme.colors.text }]}>Templates</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  Manage card templates for your decks
                </Text>
              </View>
              <Button
                testID="templates-create-new"
                title="+ New"
                variant="primary"
                size="sm"
                fullWidth={false}
                onPress={handleNew}
              />
            </View>

            {error && (
              <View style={[styles.errorBanner, { backgroundColor: palette.red[50] }]}>
                <Text style={[theme.typography.bodySmall, { color: palette.red[600] }]}>{error}</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>No templates yet</Text>
              <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
                Create a template to define your card structure
              </Text>
              <Button
                testID="templates-create-first"
                title="Create Template"
                onPress={handleNew}
              />
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  header: { gap: 10, paddingTop: 8, paddingBottom: 12 },
  backBtn: { paddingVertical: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  errorBanner: { padding: 12, borderRadius: 8 },
  cardContent: { gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fieldChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  metaRow: { flexDirection: 'row', gap: 12 },
  actionsRow: { flexDirection: 'row', gap: 8, paddingTop: 10, borderTopWidth: 1 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 },
  emptyEmoji: { fontSize: 40 },
})
