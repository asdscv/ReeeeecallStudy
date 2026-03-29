import { useState } from 'react'
import { View, Text, Alert, StyleSheet, TouchableOpacity } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { Screen, Button, Divider, ScreenHeader } from '../components/ui'
import { useCards } from '../hooks/useCards'
import { useDecks } from '../hooks/useDecks'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { fileTransferService } from '../services/file-transfer'
import type { DecksStackParamList } from '../navigation/types'

type Route = RouteProp<DecksStackParamList, 'ImportExport'>

export function ImportExportScreen() {
  const theme = useTheme()
  const { t } = useTranslation('import-export')
  const navigation = useNavigation()
  const route = useRoute<Route>()
  const { deckId } = route.params

  const { decks } = useDecks()
  const { cards, createCard } = useCards(deckId)
  const deck = decks.find((d) => d.id === deckId)

  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json')

  const handleImportCSV = async () => {
    setImporting(true)
    try {
      const file = await fileTransferService.pickCSV()
      if (!file) { setImporting(false); return }

      // Parse CSV: expect header row, then data rows
      const lines = file.content.split('\n').filter((l) => l.trim())
      if (lines.length < 2) {
        Alert.alert('Error', 'CSV file is empty or has no data rows')
        setImporting(false)
        return
      }

      const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
      let imported = 0

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
        const fieldValues: Record<string, string> = {}
        headers.forEach((h, idx) => {
          if (values[idx]) fieldValues[h] = values[idx]
        })

        if (Object.values(fieldValues).some((v) => v)) {
          await createCard({
            deck_id: deckId,
            template_id: deck?.default_template_id ?? '',
            field_values: fieldValues,
          })
          imported++
        }
      }

      Alert.alert('Success', `Imported ${imported} cards from "${file.name}"`)
    } catch (e) {
      Alert.alert('Error', 'Failed to import CSV file')
    } finally {
      setImporting(false)
    }
  }

  const handleImportJSON = async () => {
    setImporting(true)
    try {
      const file = await fileTransferService.pickJSON()
      if (!file) { setImporting(false); return }

      const data = JSON.parse(file.content)
      const cardList = Array.isArray(data) ? data : data.cards ?? []
      let imported = 0

      for (const card of cardList) {
        const fieldValues = card.field_values ?? card
        if (typeof fieldValues === 'object' && Object.values(fieldValues).some((v: any) => v)) {
          await createCard({
            deck_id: deckId,
            template_id: deck?.default_template_id ?? '',
            field_values: fieldValues,
          })
          imported++
        }
      }

      Alert.alert('Success', `Imported ${imported} cards from "${file.name}"`)
    } catch {
      Alert.alert('Error', 'Failed to parse JSON file')
    } finally {
      setImporting(false)
    }
  }

  const handleExportCSV = async () => {
    if (cards.length === 0) {
      Alert.alert('No Cards', 'This deck has no cards to export')
      return
    }

    setExporting(true)
    try {
      // Get all unique field keys
      const allKeys = new Set<string>()
      cards.forEach((c) => Object.keys(c.field_values).forEach((k) => allKeys.add(k)))
      const headers = Array.from(allKeys)

      // Build CSV
      const headerRow = headers.map((h) => `"${h}"`).join(',')
      const dataRows = cards.map((card) =>
        headers.map((h) => `"${(card.field_values[h] ?? '').replace(/"/g, '""')}"`).join(','),
      )
      const csv = [headerRow, ...dataRows].join('\n')

      const filename = `${deck?.name ?? 'deck'}-export.csv`
      const success = await fileTransferService.shareCSV(filename, csv)
      if (!success) Alert.alert('Error', 'Sharing is not available on this device')
    } catch {
      Alert.alert('Error', 'Failed to export CSV')
    } finally {
      setExporting(false)
    }
  }

  const handleExportJSON = async () => {
    if (cards.length === 0) {
      Alert.alert('No Cards', 'This deck has no cards to export')
      return
    }

    setExporting(true)
    try {
      const data = {
        deck: { name: deck?.name, description: deck?.description },
        cards: cards.map((c) => ({
          field_values: c.field_values,
          tags: c.tags,
          srs_status: c.srs_status,
        })),
      }

      const filename = `${deck?.name ?? 'deck'}-export.json`
      const success = await fileTransferService.shareJSON(filename, JSON.stringify(data, null, 2))
      if (!success) Alert.alert('Error', 'Sharing is not available on this device')
    } catch {
      Alert.alert('Error', 'Failed to export JSON')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Screen scroll testID="import-export-screen">
      <ScreenHeader title={t('title')} mode="back" />
      <View style={styles.content}>
        <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
          {deck?.name} · {cards.length} cards
        </Text>

        {/* Import */}
        <View style={styles.section}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{t('importCards')}</Text>
          <Button testID="import-csv" title={t('importCSV')} variant="outline" onPress={handleImportCSV} loading={importing} />
          <Button testID="import-json" title={t('importJSON')} variant="outline" onPress={handleImportJSON} loading={importing} />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
            CSV: first row = field names, each row = one card{'\n'}
            JSON: array of objects or {'{'} cards: [...] {'}'}
          </Text>
        </View>

        <Divider />

        {/* Export */}
        <View style={styles.section}>
          <Text style={[theme.typography.h3, { color: theme.colors.text }]}>{t('exportCards')}</Text>

          {/* Format selection pill toggles */}
          <View style={styles.formatRow}>
            <TouchableOpacity
              testID="export-format-json"
              style={[
                styles.formatPill,
                {
                  backgroundColor: exportFormat === 'json' ? theme.colors.primaryLight : theme.colors.surface,
                  borderColor: exportFormat === 'json' ? theme.colors.primary : theme.colors.border,
                },
              ]}
              onPress={() => setExportFormat('json')}
            >
              <Text
                style={[
                  theme.typography.body,
                  {
                    color: exportFormat === 'json' ? theme.colors.primary : theme.colors.textSecondary,
                    fontWeight: exportFormat === 'json' ? '600' : '400',
                  },
                ]}
              >
                JSON
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="export-format-csv"
              style={[
                styles.formatPill,
                {
                  backgroundColor: exportFormat === 'csv' ? theme.colors.primaryLight : theme.colors.surface,
                  borderColor: exportFormat === 'csv' ? theme.colors.primary : theme.colors.border,
                },
              ]}
              onPress={() => setExportFormat('csv')}
            >
              <Text
                style={[
                  theme.typography.body,
                  {
                    color: exportFormat === 'csv' ? theme.colors.primary : theme.colors.textSecondary,
                    fontWeight: exportFormat === 'csv' ? '600' : '400',
                  },
                ]}
              >
                CSV
              </Text>
            </TouchableOpacity>
          </View>

          <Button
            testID="export-btn"
            title={exportFormat === 'json' ? t('exportJSON') : t('exportCSV')}
            variant="outline"
            onPress={exportFormat === 'json' ? handleExportJSON : handleExportCSV}
            loading={exporting}
          />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingVertical: 16 },
  section: { gap: 10 },
  formatRow: { flexDirection: 'row', gap: 8 },
  formatPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
