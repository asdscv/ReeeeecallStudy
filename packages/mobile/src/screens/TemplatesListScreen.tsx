import { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen, Button, Badge, ListCard, ScreenHeader } from '../components/ui'
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

        {/* Fields — colored dot pills matching web */}
        <View style={styles.fieldsRow}>
          {item.fields.map((field) => (
            <View
              key={field.key}
              style={[styles.fieldChip, { backgroundColor: theme.colors.surface }]}
            >
              <View style={[styles.fieldDot, { backgroundColor: theme.colors.textTertiary }]} />
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                {field.name}
              </Text>
            </View>
          ))}
        </View>

        {/* Meta — matches web: "Front: X fields  Back: Y fields  Created: date" */}
        <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
          Front: {item.front_layout.length} fields{'   '}Back: {item.back_layout.length} fields{'   '}Created: {new Date(item.created_at).toLocaleDateString()}
        </Text>

        {/* Action icons — matches web: edit, duplicate, stats, delete */}
        <View style={[styles.actionsRow, { borderTopColor: theme.colors.border }]}>
          <TouchableOpacity
            testID={`template-edit-${item.id}`}
            onPress={() => handleEdit(item)}
            style={styles.iconBtn}
          >
            <Text style={{ fontSize: 18 }}>{'\u270F\uFE0F'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID={`template-duplicate-${item.id}`}
            onPress={() => handleDuplicate(item)}
            style={styles.iconBtn}
          >
            <Text style={{ fontSize: 18 }}>{'\uD83D\uDCCB'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleEdit(item)}
            style={styles.iconBtn}
          >
            <Text style={{ fontSize: 18 }}>{'\uD83D\uDCCA'}</Text>
          </TouchableOpacity>
          {!item.is_default && (
            <TouchableOpacity
              testID={`template-delete-${item.id}`}
              onPress={() => handleDelete(item)}
              disabled={deletingId === item.id}
              style={[styles.iconBtn, { marginLeft: 'auto' }]}
            >
              <Text style={{ fontSize: 18 }}>{deletingId === item.id ? '...' : '\uD83D\uDDD1\uFE0F'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ListCard>
  )

  return (
    <Screen safeArea padding={false} testID="templates-list-screen">
      <ScreenHeader title="Templates" mode="drawer" />
      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        renderItem={renderTemplate}
        refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
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
  fieldChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  fieldDot: { width: 6, height: 6, borderRadius: 3 },
  actionsRow: { flexDirection: 'row', gap: 12, paddingTop: 10, borderTopWidth: 1 },
  iconBtn: { padding: 4 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 32, alignItems: 'center', gap: 12 },
  emptyEmoji: { fontSize: 40 },
})
