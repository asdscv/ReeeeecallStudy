import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useVersionStore } from '@reeeeecall/shared/stores/version-store'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../../theme'
import { Button, Badge } from '../ui'

interface VersionHistoryTabProps {
  deckId: string
  isOwner: boolean
  testID?: string
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function VersionHistoryTab({ deckId, isOwner, testID }: VersionHistoryTabProps) {
  const theme = useTheme()
  const { t } = useTranslation('decks')
  const { versions, loading, error, creating, fetchVersions, createVersion } = useVersionStore()
  const [changeSummary, setChangeSummary] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  useEffect(() => {
    fetchVersions(deckId)
    return () => {
      useVersionStore.getState().reset()
    }
  }, [deckId, fetchVersions])

  const handleCreate = async () => {
    const result = await createVersion(deckId, changeSummary.trim() || undefined)
    if (result) {
      setChangeSummary('')
      setShowCreateForm(false)
    }
  }

  if (loading && versions.length === 0) {
    return (
      <View style={styles.loadingContainer} testID={testID}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: 8 }]}>
          Loading versions...
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container} testID={testID}>
      {/* Header with create button */}
      <View style={styles.headerRow}>
        <Text style={[theme.typography.label, { color: theme.colors.text }]}>
          {t('detail.versionHistory', { defaultValue: 'Version History' })}
        </Text>
        {isOwner && (
          <TouchableOpacity
            onPress={() => setShowCreateForm(!showCreateForm)}
            testID="version-create-toggle"
          >
            <Text style={[theme.typography.bodySmall, { color: theme.colors.primary, fontWeight: '600' }]}>
              {showCreateForm
                ? t('common:cancel', { defaultValue: 'Cancel' })
                : t('detail.createVersion', { defaultValue: '+ New Version' })}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Create form */}
      {showCreateForm && (
        <View style={[styles.createForm, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <TextInput
            value={changeSummary}
            onChangeText={setChangeSummary}
            placeholder={t('detail.versionSummaryPlaceholder', { defaultValue: 'What changed? (optional)' })}
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.background,
              },
            ]}
            testID="version-summary-input"
          />
          <Button
            title={creating
              ? t('detail.creatingVersion', { defaultValue: 'Creating...' })
              : t('detail.saveVersion', { defaultValue: 'Save Version' })}
            onPress={handleCreate}
            loading={creating}
            size="sm"
            fullWidth={false}
            testID="version-create-btn"
          />
        </View>
      )}

      {/* Error */}
      {error && (
        <Text style={[theme.typography.bodySmall, { color: theme.colors.error, marginTop: 8 }]}>
          {error}
        </Text>
      )}

      {/* Timeline */}
      {versions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('detail.noVersions', { defaultValue: 'No versions recorded yet.' })}
          </Text>
          {isOwner && (
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center', marginTop: 4 }]}>
              Create a version to snapshot your deck's current state.
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.timeline}>
          {versions.map((version, index) => (
            <View key={version.id} style={styles.timelineItem} testID={`version-item-${version.version_number}`}>
              {/* Timeline line */}
              {index < versions.length - 1 && (
                <View style={[styles.timelineLine, { backgroundColor: theme.colors.border }]} />
              )}

              {/* Version number badge */}
              <View style={[styles.versionBadge, { backgroundColor: palette.blue[100] }]}>
                <Text style={[styles.versionBadgeText, { color: palette.blue[700] }]}>
                  v{version.version_number}
                </Text>
              </View>

              {/* Content */}
              <View style={styles.versionContent}>
                <View style={styles.versionHeader}>
                  <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                    {t('detail.versionLabel', {
                      defaultValue: 'Version {{num}}',
                      num: version.version_number,
                    })}
                  </Text>
                  <Badge
                    label={`${version.card_count} ${t('detail.versionCards', { defaultValue: 'cards' })}`}
                    variant="neutral"
                  />
                </View>
                {version.change_summary && (
                  <Text
                    style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}
                    numberOfLines={2}
                  >
                    {version.change_summary}
                  </Text>
                )}
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                  {formatDate(version.created_at)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  createForm: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  timeline: {
    gap: 0,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 16,
    top: 42,
    bottom: -10,
    width: 2,
  },
  versionBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  versionContent: {
    flex: 1,
    gap: 2,
  },
  versionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})
