import { useTranslation } from 'react-i18next'
import { aiHubEntries } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { useAuthStore } from '../../stores/auth-store'

/** The navigation's destinations, shared by the sidebar and the phone menu sheet (AppNav.tsx). */
export interface NavEntry {
  path: string
  label: string
  icon: string
}

export interface NavSection {
  /** Absent for the first block, which needs no heading. */
  label?: string
  entries: NavEntry[]
}

/** Every destination, grouped the way the sidebar and the sheet both show them. */
export function useNavSections(): { sections: NavSection[]; footer: NavEntry[] } {
  // 'ai-generate' is declared alongside 'common' so the registry-derived labels wait for their
  // bundle instead of painting raw keys on first render.
  const { t } = useTranslation(['common', 'ai-generate'])
  const role = useAuthStore((s) => s.role)
  const sections: NavSection[] = [
    {
      entries: [
        { path: '/dashboard', label: t('nav.dashboard'), icon: 'bar-chart-2' },
        { path: '/brain', label: t('nav.brainTraining'), icon: 'grid' },
      ],
    },
    {
      label: t('nav.study'),
      entries: [
        { path: '/decks', label: t('nav.decks'), icon: 'book-open' },
        { path: '/templates', label: t('nav.cardTemplates'), icon: 'file-text' },
      ],
    },
    {
      // Derived, not listed: registering another AI feature adds its row without an edit here.
      label: t('nav.aiHub'),
      entries: [
        { path: '/ai', label: t('nav.aiHubHome'), icon: 'layers' },
        ...aiHubEntries().map((entry) => ({
          path: entry.webPath,
          label: t(entry.titleKey, { ns: 'ai-generate' }),
          icon: entry.icon,
        })),
      ],
    },
    {
      label: t('nav.explore'),
      entries: [
        { path: '/marketplace', label: t('nav.marketplace'), icon: 'shopping-bag' },
        { path: '/publisher', label: t('nav.publisher'), icon: 'trending-up' },
        { path: '/my-shares', label: t('nav.myShares'), icon: 'link-2' },
      ],
    },
    {
      label: t('nav.myRecords'),
      entries: [
        { path: '/history', label: t('nav.studyHistory'), icon: 'clock' },
        { path: '/achievements', label: t('nav.achievements'), icon: 'award' },
      ],
    },
  ]
  const footer: NavEntry[] = [
    { path: '/guide', label: t('nav.guide'), icon: 'help-circle' },
    { path: '/settings', label: t('nav.settings'), icon: 'settings' },
    ...(role === 'admin' ? [{ path: '/admin', label: t('nav.admin'), icon: 'shield' }] : []),
  ]
  return { sections, footer }
}

/**
 * Segment-boundary match: '/ai' is the hub and '/ai-generate' a sibling route, so a bare
 * startsWith would light both.
 */
export function isPathActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

