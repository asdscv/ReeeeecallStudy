import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, TextInput, DrawerHeader } from '../components/ui'

import { useTheme } from '../theme'

// ── Types ──────────────────────────────────────────────────────────
interface GuideItem {
  title: string
  body: string
  link?: { label: string; href: string }
}
interface GuideSection {
  id: string
  title: string
  icon: string
  items: GuideItem[]
}

// Section keys — order matches the guide JSON structure
const SECTION_KEYS = [
  'gettingStarted',
  'decks',
  'cards',
  'study',
  'importExport',
  'sharing',
  'marketplace',
  'history',
  'settings',
  'aiGenerate',
  'tips',
] as const

// Item keys per section
const ITEM_KEYS: Record<string, string[]> = {
  gettingStarted: ['login', 'dashboard', 'navigation'],
  decks: ['create', 'detail', 'edit', 'delete'],
  cards: ['add', 'editDelete', 'searchFilter'],
  study: ['modes', 'science', 'srsMethod', 'sessionFlow', 'swipeMode', 'cramming'],
  importExport: ['jsonImport', 'csvImport', 'jsonExport', 'csvExport'],
  sharing: ['copy', 'subscribe', 'snapshot'],
  marketplace: ['what', 'getting', 'publishing'],
  history: ['viewing', 'dashboardStats'],
  settings: ['profile', 'srsLimit', 'answerMode', 'autoTts'],
  aiGenerate: ['what', 'apiKey', 'fullGeneration'],
  tips: ['daily', 'again', 'concise', 'tags'],
}

export function GuideScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const { t } = useTranslation('guide')
  const [search, setSearch] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // Build sections from i18n
  const SECTIONS: GuideSection[] = useMemo(
    () =>
      SECTION_KEYS.map((key) => ({
        id: key,
        title: t(`sections.${key}.title`),
        icon: t(`sections.${key}.icon`),
        items: (ITEM_KEYS[key] ?? []).map((itemKey) => ({
          title: t(`sections.${key}.items.${itemKey}.title`),
          body: t(`sections.${key}.items.${itemKey}.body`),
        })),
      })),
    [t],
  )

  const query = search.trim().toLowerCase()
  const filtered = query
    ? SECTIONS.map((s) => {
        const matchTitle = s.title.toLowerCase().includes(query)
        const matchItems = s.items.filter(
          (i) => i.title.toLowerCase().includes(query) || i.body.toLowerCase().includes(query),
        )
        if (matchTitle) return s
        if (matchItems.length > 0) return { ...s, items: matchItems }
        return null
      }).filter((s): s is GuideSection => s !== null)
    : SECTIONS

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Screen safeArea padding={false} testID="guide-screen">
      <DrawerHeader title={t('title')} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginBottom: 12 }]}>
          {t('subtitle')}
        </Text>

        {/* Search */}
        <TextInput
          testID="guide-search"
          value={search}
          onChangeText={setSearch}
          placeholder={t('searchPlaceholder')}
        />

        {/* Table of Contents — matches web */}
        {!query && (
          <View style={[styles.tocCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[styles.tocTitle, { color: theme.colors.text }]}>{t('tableOfContents')}</Text>
            {SECTIONS.map((s) => (
              <TouchableOpacity
                key={s.id}
                onPress={() => {
                  toggleSection(s.id)
                  setExpandedSections((prev) => new Set([...prev, s.id]))
                }}
                style={styles.tocItem}
              >
                <Text style={styles.tocIcon}>{s.icon}</Text>
                <Text style={[styles.tocLabel, { color: theme.colors.textSecondary }]}>{s.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Sections */}
        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              {t('noResults', { query: search })}
            </Text>
          </View>
        )}

        {filtered.map((section) => {
          const isExpanded = expandedSections.has(section.id)
          return (
            <View
              key={section.id}
              style={[styles.sectionCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}
            >
              <TouchableOpacity
                onPress={() => toggleSection(section.id)}
                style={styles.sectionHeader}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionIcon}>{section.icon}</Text>
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{section.title}</Text>
                <Text style={[styles.sectionChevron, { color: theme.colors.textSecondary }]}>
                  {isExpanded ? '∧' : '∨'}
                </Text>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.itemsContainer}>
                  {section.items.map((item, idx) => (
                    <View
                      key={idx}
                      style={[styles.item, idx > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.border }]}
                    >
                      <Text style={[styles.itemTitle, { color: theme.colors.text }]}>{item.title}</Text>
                      <Text style={[styles.itemBody, { color: theme.colors.textSecondary }]}>{item.body}</Text>
                      {item.link && (
                        <TouchableOpacity onPress={() => Linking.openURL(item.link!.href)} style={styles.linkBtn}>
                          <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>{item.link.label}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        })}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  backBtn: { paddingVertical: 8 },
  pageTitle: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  // Table of Contents
  tocCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 12 },
  tocTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  tocItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  tocIcon: { fontSize: 16 },
  tocLabel: { fontSize: 13 },
  empty: { paddingVertical: 40, alignItems: 'center' },
  sectionCard: { borderRadius: 12, borderWidth: 1, marginTop: 12, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  sectionIcon: { fontSize: 20 },
  sectionTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  sectionChevron: { fontSize: 18, fontWeight: '300' },
  itemsContainer: { paddingHorizontal: 14, paddingBottom: 14 },
  item: { paddingVertical: 12 },
  itemTitle: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  itemBody: { fontSize: 13, lineHeight: 20 },
  linkBtn: { marginTop: 8 },
  bottomSpacer: { height: 20 },
})
