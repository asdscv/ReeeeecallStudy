/**
 * Where the learner is, read from the drawer's navigation state.
 *
 * The drawer used to track its own "active item" in local state, set when a row was tapped — so
 * reaching a screen any other way (a dashboard card, a deck's study button, now the tab bar) left
 * the drawer highlighting wherever the last tap went. Deriving it from the real state means the
 * drawer and the tab bar can never disagree.
 */
export interface NavLocation {
  /** The drawer route (one of MainTabParamList). */
  stack: string
  /** The focused screen inside that stack. */
  leaf: string
}

interface StateLike {
  index?: number
  routes: { name: string; state?: StateLike; params?: object }[]
}

/** Each stack's first screen — the leaf before its own navigator has state. */
const FIRST_SCREEN: Record<string, string> = {
  HomeTab: 'Dashboard',
  DecksTab: 'DecksList',
  StudyTab: 'StudySetup',
  AITab: 'AIHub',
  QuizTab: 'QuizHome',
  BrainTab: 'BrainHome',
  MarketplaceTab: 'MarketplaceHome',
  SettingsTab: 'SettingsHome',
}

export function navLocation(drawerState: StateLike | undefined): NavLocation {
  if (!drawerState || drawerState.routes.length === 0) return { stack: 'HomeTab', leaf: 'Dashboard' }
  const route = drawerState.routes[drawerState.index ?? 0]
  const child = route.state
  const leaf = child ? child.routes[child.index ?? child.routes.length - 1]?.name : undefined
  return { stack: route.name, leaf: leaf ?? FIRST_SCREEN[route.name] ?? route.name }
}

/** Focus surfaces — a study session, a quiz in progress, a brain game — take the whole screen. */
const FULLSCREEN = new Set(['StudySession', 'StudySummary', 'QuizRun', 'BrainPlay', 'BrainTraining'])

export function showsTabBar(loc: NavLocation): boolean {
  return !FULLSCREEN.has(loc.leaf)
}

/** Whether a screen takes the whole screen — no tab bar, and no drawer edge swipe either. */
export function isFullscreenScreen(name: string | undefined): boolean {
  return name !== undefined && FULLSCREEN.has(name)
}

export type TabKey = 'home' | 'study' | 'decks' | 'brain' | 'more'

/** Which tab a location belongs to. Anything outside the four lights "메뉴". */
export function tabFor(loc: NavLocation): TabKey {
  if (loc.stack === 'HomeTab' && loc.leaf === 'Dashboard') return 'home'
  if (loc.stack === 'StudyTab') return 'study'
  if (loc.stack === 'DecksTab' || loc.leaf === 'TemplatesList' || loc.leaf === 'TemplateEdit') return 'decks'
  if (loc.stack === 'BrainTab') return 'brain'
  return 'more'
}

/**
 * Drawer rows are named by the screen they open. A row is active when that screen is focused —
 * or, for a stack's entry row, when anywhere in that stack is.
 */
export function isDrawerItemActive(item: string, loc: NavLocation): boolean {
  switch (item) {
    case 'QuickStudy':
      return loc.stack === 'StudyTab'
    case 'DecksTab':
      return loc.stack === 'DecksTab'
    case 'MarketplaceTab':
      return loc.stack === 'MarketplaceTab'
    case 'BrainHome':
      return loc.stack === 'BrainTab'
    case 'QuizHome':
      return loc.stack === 'QuizTab'
    default:
      return loc.leaf === item
  }
}
