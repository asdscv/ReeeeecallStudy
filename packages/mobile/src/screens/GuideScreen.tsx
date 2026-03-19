import { useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, TextInput } from '../components/ui'

import { useTheme, palette } from '../theme'

// ── Inline guide data (matches web guide.json EN) ──────────────────
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

const SECTIONS: GuideSection[] = [
  {
    id: 'getting-started', title: 'Getting Started', icon: '🚀',
    items: [
      { title: 'Login', body: 'Log in with your email and password. When you sign up, a verification email is sent — click the link to complete registration.' },
      { title: 'Home (Dashboard)', body: 'After login, the dashboard appears. See total cards, today\'s review cards, study streak, and mastery rate at a glance.' },
      { title: 'Navigation', body: 'Use the bottom tab bar to navigate between Home, Decks, Study, Marketplace, and Settings.' },
    ],
  },
  {
    id: 'decks', title: 'Deck Management', icon: '📚',
    items: [
      { title: 'Create a Deck', body: 'On the Decks page, press the + button. Set the name, description, icon, and color.' },
      { title: 'Deck Detail View', body: 'Click a deck to see its card list. Use the top buttons to add cards, import, export, share, or edit the deck.' },
      { title: 'Edit Deck', body: 'Change the name, description, icon, color, and default template on the deck edit page.' },
      { title: 'Delete Deck', body: 'Press the delete button on the deck detail page. Deleting a deck also removes all its cards.' },
    ],
  },
  {
    id: 'cards', title: 'Card Management', icon: '🃏',
    items: [
      { title: 'Add Cards', body: 'Press the + button on the deck detail page. Fill in the fields defined in the template.' },
      { title: 'Edit & Delete Cards', body: 'Tap a card in the list to edit. Modify field content and tags.' },
      { title: 'Search & Filter', body: 'Use the search bar to search across all fields. Select a status filter (new, learning, review) to view specific cards.' },
    ],
  },
  {
    id: 'study', title: 'Study', icon: '📖',
    items: [
      { title: 'Study Modes', body: 'SRS: Spaced repetition with 4 buttons (Again/Hard/Good/Easy).\nSequential Review: In order, mixing new + review cards.\nRandom: Randomly drawn cards.\nSequential: Cards in order.\nBy Date: Cards by upload date.\n\nSequential Review, Random, Sequential, By Date use 2 buttons (Unknown/Known).\n\nCramming: Intensive round-based review with 2 buttons (Missed/Got It). Does not affect SRS schedule.' },
      { title: 'The Science Behind SRS', body: 'SRS is based on the forgetting curve. By reviewing just before you forget, information moves to long-term memory. Cards you know well appear less often; cards you struggle with appear more frequently.' },
      { title: 'SRS Study Method', body: 'Again (Red): "I didn\'t remember" — card reappears soon.\nHard (Orange): "Barely recalled" — shorter interval.\nGood (Blue): "Remembered well" — normal interval.\nEasy (Green): "Instant recall" — longer interval.\n\nTip: When in doubt, press Good.' },
      { title: 'Study Session Flow', body: '1. Select deck → Set study mode → Start\n2. See card front → Tap to flip → Choose rating\n3. After all cards, a summary shows study count, time, and rating distribution.' },
      { title: 'Swipe Mode', body: 'Switch to Swipe mode in Settings to rate by swiping.\nSRS: ← Again / → Good\nOther modes: ← Unknown / → Known\nCramming: ← Missed / → Got It' },
      { title: 'Cramming Mode', body: 'All cards are presented. Missed cards reappear until mastered. Use card filters (All/Weak/Due Soon) and time limits. Does NOT affect SRS schedule.' },
    ],
  },
  {
    id: 'import-export', title: 'Import & Export', icon: '📦',
    items: [
      { title: 'JSON Import', body: 'On deck detail, tap Import → select a JSON file. Ideal for backup and restore.' },
      { title: 'CSV Import', body: 'CSV files from Excel can be imported. Column mapping matches fields automatically.' },
      { title: 'JSON Export', body: 'Deck detail → Export → JSON downloads the full deck as one file.' },
      { title: 'CSV Export', body: 'CSV format opens directly in Excel/Google Sheets.' },
    ],
  },
  {
    id: 'sharing', title: 'Deck Sharing', icon: '🔗',
    items: [
      { title: 'Copy Mode', body: 'Gives an independent, editable copy. Original and copy don\'t affect each other.' },
      { title: 'Subscribe Mode', body: 'Recipients get auto-updates when you add cards. Study progress is independent.' },
      { title: 'Snapshot Mode', body: 'Creates a read-only copy at the current point in time.' },
    ],
  },
  {
    id: 'marketplace', title: 'Marketplace', icon: '🏪',
    items: [
      { title: 'What is the Marketplace?', body: 'Search and get decks shared by other users. Filter by category and tags.' },
      { title: 'Getting a Deck', body: 'Click a deck to preview cards, then press "Get" to add it to your decks.' },
      { title: 'Publishing Your Deck', body: 'Deck detail → Publish → Set title, description, category, and share mode.' },
    ],
  },
  {
    id: 'history', title: 'Study History & Statistics', icon: '📊',
    items: [
      { title: 'Viewing Study History', body: 'View all study sessions by date on the History page. Filter by deck or mode.' },
      { title: 'Dashboard Statistics', body: 'Switch period tabs on the dashboard to view heatmap, daily study chart, and forecast.' },
    ],
  },
  {
    id: 'settings', title: 'Settings', icon: '⚙️',
    items: [
      { title: 'Profile', body: 'Set your display name. Email cannot be changed.' },
      { title: 'SRS New Card Limit', body: 'Set the maximum number of new cards per SRS session.' },
      { title: 'Answer Mode', body: 'Button mode: Tap rating buttons. Swipe mode: Swipe cards to rate.' },
      { title: 'Auto TTS', body: 'Auto-reads TTS-enabled fields when flipping cards. Adjust speed with the slider (0.5x - 2.0x).' },
    ],
  },
  {
    id: 'ai-generate', title: 'AI Auto-Generate', icon: '🤖',
    items: [
      { title: 'What is AI Auto-Generate?', body: 'Create flashcards automatically using AI. Enter a topic and AI generates everything for you.' },
      { title: 'Setting Up API Key', body: 'Get an API key from OpenAI or xAI. Enter it in AI Generate settings. Keys are stored locally.' },
      { title: 'Full Generation', body: 'Go to AI Generate → Enter topic → Set card count → Start. AI creates template, deck, and cards.' },
    ],
  },
  {
    id: 'tips', title: 'Study Tips', icon: '💡',
    items: [
      { title: 'Study a Little Every Day', body: 'SRS is most effective with daily consistency. 10-20 minutes a day is enough.' },
      { title: "Don't Be Afraid of Again", body: "Honestly marking cards you don't remember as 'Again' helps the system. Forcing 'Good' reduces effectiveness." },
      { title: 'Keep Cards Concise', body: "Put just one concept per card. Short, clear cards are far more effective." },
      { title: 'Use Tags', body: "Add tags for quick filtering. Examples: 'grammar', 'verbs', 'Chapter1'." },
    ],
  },
]

export function GuideScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const [search, setSearch] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Back + title */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>{'← Back'}</Text>
        </TouchableOpacity>

        <Text style={[theme.typography.h2, styles.pageTitle, { color: theme.colors.text }]}>Guide</Text>
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginBottom: 12 }]}>
          Learn all features of ReeeeecallStudy
        </Text>

        {/* Search */}
        <TextInput
          testID="guide-search"
          value={search}
          onChangeText={setSearch}
          placeholder={'Search features (e.g., SRS, Import, Share...)'}
        />

        {/* Table of Contents — matches web */}
        {!query && (
          <View style={[styles.tocCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            <Text style={[styles.tocTitle, { color: theme.colors.text }]}>{'Table of Contents'}</Text>
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
              No results for "{search}"
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
                <Text style={[styles.sectionChevron, { color: theme.colors.textTertiary }]}>
                  {isExpanded ? '▾' : '▸'}
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
  sectionChevron: { fontSize: 16 },
  itemsContainer: { paddingHorizontal: 14, paddingBottom: 14 },
  item: { paddingVertical: 12 },
  itemTitle: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  itemBody: { fontSize: 13, lineHeight: 20 },
  linkBtn: { marginTop: 8 },
  bottomSpacer: { height: 20 },
})
