// ─── Guide Content — 사용법 페이지 데이터 (i18n keys) ──────────────────

export interface GuideItemLink {
  /** i18n key for the button label */
  label: string
  /** External URL (opens in new tab) */
  href?: string
  /** Internal React Router path */
  to?: string
}

export interface GuideItem {
  title: string
  body: string
  /** Optional link/button displayed below the body text */
  link?: GuideItemLink
  /** Optional screenshot images (pc + mobile pairs) */
  images?: { pc: string; mobile: string; alt?: string }[]
}

export interface GuideSection {
  id: string
  title: string
  icon: string
  items: GuideItem[]
}

// ─── Helper to shorten image paths ─────────────────────────
const img = (section: string, name: string) => ({
  pc: `/images/guide/${section}/${name}-pc.png`,
  mobile: `/images/guide/${section}/${name}-mobile.png`,
  alt: name,
})

export const GUIDE_SECTIONS: GuideSection[] = [
  // ───────────────────────────────────────────────────
  {
    id: 'ai-generate',
    title: 'sections.ai-generate.title',
    icon: '🤖',
    items: [
      {
        title: 'sections.ai-generate.items.what.title',
        body: 'sections.ai-generate.items.what.body',
        images: [
          { pc: '/images/guide/ai-generate/pc-01-page.png', mobile: '/images/guide/ai-generate/mobile-01-page.png', alt: 'AI Generate page' },
        ],
      },
      {
        title: 'sections.ai-generate.items.apiKeySetup.title',
        body: 'sections.ai-generate.items.apiKeySetup.body',
        images: [
          { pc: '/images/guide/ai-generate/pc-02-config.png', mobile: '/images/guide/ai-generate/mobile-02-config.png', alt: 'Config step' },
        ],
      },
      {
        title: 'sections.ai-generate.items.geminiSetup.title',
        body: 'sections.ai-generate.items.geminiSetup.body',
        link: {
          label: 'sections.ai-generate.items.geminiSetup.linkLabel',
          href: 'https://aistudio.google.com/apikey',
        },
        images: [
          { pc: '/images/guide/gemini-api/01-ai-studio-home.png', mobile: '/images/guide/gemini-api/01-ai-studio-home.png', alt: 'Google AI Studio home' },
          { pc: '/images/guide/gemini-api/02-get-api-key.png', mobile: '/images/guide/gemini-api/02-get-api-key.png', alt: 'Get API key button' },
          { pc: '/images/guide/gemini-api/03-create-api-key.png', mobile: '/images/guide/gemini-api/03-create-api-key.png', alt: 'Create API key' },
          { pc: '/images/guide/gemini-api/04-create-new-project.png', mobile: '/images/guide/gemini-api/04-create-new-project.png', alt: 'Create new project' },
          { pc: '/images/guide/gemini-api/05-api-key-created.png', mobile: '/images/guide/gemini-api/05-api-key-created.png', alt: 'API key created' },
        ],
      },
      {
        title: 'sections.ai-generate.items.fullGenerate.title',
        body: 'sections.ai-generate.items.fullGenerate.body',
        images: [
          { pc: '/images/guide/ai-generate/pc-03-generating.png', mobile: '/images/guide/ai-generate/mobile-03-generating.png', alt: 'Generating' },
          { pc: '/images/guide/ai-generate/pc-04-review-template.png', mobile: '/images/guide/ai-generate/mobile-04-review-template.png', alt: 'Template review' },
          { pc: '/images/guide/ai-generate/pc-05-review-deck.png', mobile: '/images/guide/ai-generate/mobile-05-review-deck.png', alt: 'Deck review' },
          { pc: '/images/guide/ai-generate/pc-06-review-cards.png', mobile: '/images/guide/ai-generate/mobile-06-review-cards.png', alt: 'Cards review' },
        ],
      },
      {
        title: 'sections.ai-generate.items.addCards.title',
        body: 'sections.ai-generate.items.addCards.body',
      },
      {
        title: 'sections.ai-generate.items.editResults.title',
        body: 'sections.ai-generate.items.editResults.body',
        images: [
          { pc: '/images/guide/ai-generate/pc-07-done.png', mobile: '/images/guide/ai-generate/mobile-07-done.png', alt: 'Done' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'getting-started',
    title: 'sections.getting-started.title',
    icon: '🚀',
    items: [
      {
        title: 'sections.getting-started.items.login.title',
        body: 'sections.getting-started.items.login.body',
      },
      {
        title: 'sections.getting-started.items.dashboard.title',
        body: 'sections.getting-started.items.dashboard.body',
        images: [img('getting-started', 'dashboard')],
      },
      {
        title: 'sections.getting-started.items.navigation.title',
        body: 'sections.getting-started.items.navigation.body',
        images: [img('getting-started', 'navigation')],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'decks',
    title: 'sections.decks.title',
    icon: '📚',
    items: [
      {
        title: 'sections.decks.items.create.title',
        body: 'sections.decks.items.create.body',
        images: [img('decks', 'list')],
      },
      {
        title: 'sections.decks.items.detail.title',
        body: 'sections.decks.items.detail.body',
        images: [img('decks', 'detail')],
      },
      {
        title: 'sections.decks.items.edit.title',
        body: 'sections.decks.items.edit.body',
      },
      {
        title: 'sections.decks.items.delete.title',
        body: 'sections.decks.items.delete.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'cards',
    title: 'sections.cards.title',
    icon: '🃏',
    items: [
      {
        title: 'sections.cards.items.add.title',
        body: 'sections.cards.items.add.body',
        images: [img('cards', 'table')],
      },
      {
        title: 'sections.cards.items.editDelete.title',
        body: 'sections.cards.items.editDelete.body',
      },
      {
        title: 'sections.cards.items.searchFilter.title',
        body: 'sections.cards.items.searchFilter.body',
      },
      {
        title: 'sections.cards.items.srsReset.title',
        body: 'sections.cards.items.srsReset.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'templates',
    title: 'sections.templates.title',
    icon: '📋',
    items: [
      {
        title: 'sections.templates.items.what.title',
        body: 'sections.templates.items.what.body',
        images: [img('templates', 'list')],
      },
      {
        title: 'sections.templates.items.createEdit.title',
        body: 'sections.templates.items.createEdit.body',
        images: [img('templates', 'edit')],
      },
      {
        title: 'sections.templates.items.layout.title',
        body: 'sections.templates.items.layout.body',
      },
      {
        title: 'sections.templates.items.tts.title',
        body: 'sections.templates.items.tts.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'study',
    title: 'sections.study.title',
    icon: '📖',
    items: [
      {
        title: 'sections.study.items.modes.title',
        body: 'sections.study.items.modes.body',
        images: [img('study', 'setup')],
      },
      {
        title: 'sections.study.items.srsScience.title',
        body: 'sections.study.items.srsScience.body',
      },
      {
        title: 'sections.study.items.srsMethod.title',
        body: 'sections.study.items.srsMethod.body',
      },
      {
        title: 'sections.study.items.srsCardStates.title',
        body: 'sections.study.items.srsCardStates.body',
      },
      {
        title: 'sections.study.items.srsIntervals.title',
        body: 'sections.study.items.srsIntervals.body',
      },
      {
        title: 'sections.study.items.quickStudy.title',
        body: 'sections.study.items.quickStudy.body',
        images: [img('study', 'quick-study')],
      },
      {
        title: 'sections.study.items.sessionFlow.title',
        body: 'sections.study.items.sessionFlow.body',
      },
      {
        title: 'sections.study.items.swipeMode.title',
        body: 'sections.study.items.swipeMode.body',
      },
      {
        title: 'sections.study.items.srsCustom.title',
        body: 'sections.study.items.srsCustom.body',
      },
      {
        title: 'sections.study.items.cramming.title',
        body: 'sections.study.items.cramming.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'import-export',
    title: 'sections.import-export.title',
    icon: '📦',
    items: [
      {
        title: 'sections.import-export.items.jsonImport.title',
        body: 'sections.import-export.items.jsonImport.body',
        images: [img('import-export', 'buttons')],
      },
      {
        title: 'sections.import-export.items.csvImport.title',
        body: 'sections.import-export.items.csvImport.body',
      },
      {
        title: 'sections.import-export.items.duplicates.title',
        body: 'sections.import-export.items.duplicates.body',
      },
      {
        title: 'sections.import-export.items.jsonExport.title',
        body: 'sections.import-export.items.jsonExport.body',
      },
      {
        title: 'sections.import-export.items.csvExport.title',
        body: 'sections.import-export.items.csvExport.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'sharing',
    title: 'sections.sharing.title',
    icon: '🔗',
    items: [
      {
        title: 'sections.sharing.items.copy.title',
        body: 'sections.sharing.items.copy.body',
        images: [img('sharing', 'share-page')],
      },
      {
        title: 'sections.sharing.items.subscribe.title',
        body: 'sections.sharing.items.subscribe.body',
      },
      {
        title: 'sections.sharing.items.snapshot.title',
        body: 'sections.sharing.items.snapshot.body',
      },
      {
        title: 'sections.sharing.items.inviteLink.title',
        body: 'sections.sharing.items.inviteLink.body',
      },
      {
        title: 'sections.sharing.items.manage.title',
        body: 'sections.sharing.items.manage.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'marketplace',
    title: 'sections.marketplace.title',
    icon: '🏪',
    items: [
      {
        title: 'sections.marketplace.items.what.title',
        body: 'sections.marketplace.items.what.body',
        images: [img('marketplace', 'browse')],
      },
      {
        title: 'sections.marketplace.items.getDeck.title',
        body: 'sections.marketplace.items.getDeck.body',
      },
      {
        title: 'sections.marketplace.items.publish.title',
        body: 'sections.marketplace.items.publish.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'history',
    title: 'sections.history.title',
    icon: '📊',
    items: [
      {
        title: 'sections.history.items.viewHistory.title',
        body: 'sections.history.items.viewHistory.body',
        images: [img('history', 'overview')],
      },
      {
        title: 'sections.history.items.deckProgress.title',
        body: 'sections.history.items.deckProgress.body',
      },
      {
        title: 'sections.history.items.dashboardStats.title',
        body: 'sections.history.items.dashboardStats.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'settings',
    title: 'sections.settings.title',
    icon: '⚙️',
    items: [
      {
        title: 'sections.settings.items.profile.title',
        body: 'sections.settings.items.profile.body',
        images: [img('settings', 'page')],
      },
      {
        title: 'sections.settings.items.srsLimit.title',
        body: 'sections.settings.items.srsLimit.body',
      },
      {
        title: 'sections.settings.items.answerMode.title',
        body: 'sections.settings.items.answerMode.body',
      },
      {
        title: 'sections.settings.items.autoTts.title',
        body: 'sections.settings.items.autoTts.body',
      },
      {
        title: 'sections.settings.items.apiKey.title',
        body: 'sections.settings.items.apiKey.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'api',
    title: 'sections.api.title',
    icon: '📡',
    items: [
      {
        title: 'sections.api.items.whatSimple.title',
        body: 'sections.api.items.whatSimple.body',
      },
      {
        title: 'sections.api.items.whyApi.title',
        body: 'sections.api.items.whyApi.body',
      },
      {
        title: 'sections.api.items.getKey.title',
        body: 'sections.api.items.getKey.body',
      },
      {
        title: 'sections.api.items.step1Prepare.title',
        body: 'sections.api.items.step1Prepare.body',
      },
      {
        title: 'sections.api.items.step2Query.title',
        body: 'sections.api.items.step2Query.body',
      },
      {
        title: 'sections.api.items.step3AiGenerate.title',
        body: 'sections.api.items.step3AiGenerate.body',
      },
      {
        title: 'sections.api.items.aiExamples.title',
        body: 'sections.api.items.aiExamples.body',
      },
      {
        title: 'sections.api.items.step4Manual.title',
        body: 'sections.api.items.step4Manual.body',
      },
      {
        title: 'sections.api.items.docsPage.title',
        body: 'sections.api.items.docsPage.body',
        link: {
          label: 'sections.api.items.docsPage.linkLabel',
          href: 'https://reeeeecallstudy.xyz/docs/api',
        },
      },
      {
        title: 'sections.api.items.rateLimits.title',
        body: 'sections.api.items.rateLimits.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'tips',
    title: 'sections.tips.title',
    icon: '💡',
    items: [
      {
        title: 'sections.tips.items.daily.title',
        body: 'sections.tips.items.daily.body',
      },
      {
        title: 'sections.tips.items.again.title',
        body: 'sections.tips.items.again.body',
      },
      {
        title: 'sections.tips.items.concise.title',
        body: 'sections.tips.items.concise.body',
      },
      {
        title: 'sections.tips.items.tags.title',
        body: 'sections.tips.items.tags.body',
      },
    ],
  },
]

/** ID로 섹션 찾기 */
export function getSection(id: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find((s) => s.id === id)
}

/** 키워드 검색 — 매칭되는 섹션만 반환 (번역된 텍스트에서 검색) */
export function searchGuide(query: string, t: (key: string) => string): GuideSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return GUIDE_SECTIONS

  return GUIDE_SECTIONS
    .map((section) => {
      const sectionTitleMatch = t(section.title).toLowerCase().includes(q)
      const matchingItems = section.items.filter(
        (item) =>
          t(item.title).toLowerCase().includes(q) ||
          t(item.body).toLowerCase().includes(q)
      )

      if (sectionTitleMatch) return section
      if (matchingItems.length > 0) return { ...section, items: matchingItems }
      return null
    })
    .filter((s): s is GuideSection => s !== null)
}
