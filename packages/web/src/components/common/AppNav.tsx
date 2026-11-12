import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Zap, BarChart2, BookOpen, Cpu, Layers, FileText, Store, TrendingUp, Link2, Clock, Award,
  Settings as SettingsIcon, Shield, HelpCircle, Target, LayoutGrid, Menu, X, type LucideIcon,
} from 'lucide-react'
import { useNavSections, isPathActive, type NavEntry } from './nav-model'

/**
 * The app's navigation, in one place for every width.
 *
 * It used to be a top bar with five links and a "학습" dropdown holding four collapsible
 * sections — decks, AI, explore and records were two clicks deep behind a menu whose label said
 * nothing about them, and the links drew their icon ABOVE the label (Tailwind's preflight makes an
 * `svg` a block, so inside a plain inline link it took its own line) while the dropdown button,
 * a flex row, drew it beside. Every destination is now visible at once: a sidebar from `lg` up, and
 * below that a bottom tab bar for the five most used places plus a full-menu sheet for the rest.
 */
const ICONS: Record<string, LucideIcon> = {
  zap: Zap,
  'bar-chart-2': BarChart2,
  'book-open': BookOpen,
  cpu: Cpu,
  layers: Layers,
  'file-text': FileText,
  'shopping-bag': Store,
  'trending-up': TrendingUp,
  'link-2': Link2,
  clock: Clock,
  award: Award,
  settings: SettingsIcon,
  shield: Shield,
  'help-circle': HelpCircle,
  target: Target,
  grid: LayoutGrid,
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name]
  return Icon ? <Icon className={className ?? 'w-[18px] h-[18px] shrink-0'} aria-hidden="true" /> : null
}

function NavRow({ entry, active, onNavigate }: { entry: NavEntry; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      to={entry.path}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 h-11 px-3 rounded-lg text-sm no-underline transition-colors ${
        active ? 'bg-brand/10 text-brand-active font-semibold' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
      data-testid={`nav-${entry.path.slice(1).replace(/\//g, '-')}`}
    >
      <NavIcon name={entry.icon} />
      <span className="truncate">{entry.label}</span>
    </Link>
  )
}

/** The full menu: quick-study call to action, every section, settings at the foot. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const { sections, footer } = useNavSections()
  return (
    <div className="flex flex-col h-full">
      <Link
        to="/quick-study"
        onClick={onNavigate}
        className={`flex items-center justify-center gap-2 h-11 mx-3 mb-3 rounded-lg text-sm font-semibold no-underline transition-colors ${
          isPathActive(pathname, '/quick-study') ? 'bg-brand-active text-brand-foreground' : 'bg-brand text-brand-foreground hover:bg-brand-hover'
        }`}
        data-testid="nav-quick-study"
      >
        <Zap className="w-4 h-4" aria-hidden="true" />
        {t('nav.quickStudy')}
      </Link>
      <nav aria-label={t('menu')} className="flex-1 overflow-y-auto px-3 space-y-4 pb-3">
        {sections.map((section, i) => (
          <div key={section.label ?? i}>
            {section.label && (
              <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground">{section.label}</p>
            )}
            <div className="space-y-0.5">
              {section.entries.map((entry) => (
                <NavRow key={entry.path} entry={entry} active={isPathActive(pathname, entry.path)} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-3 pt-2 pb-3 space-y-0.5">
        {footer.map((entry) => (
          <NavRow key={entry.path} entry={entry} active={isPathActive(pathname, entry.path)} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}

const TABS: { path: string; key: string; icon: LucideIcon; match: string[] }[] = [
  { path: '/dashboard', key: 'home', icon: BarChart2, match: ['/dashboard'] },
  { path: '/quick-study', key: 'study', icon: Zap, match: ['/quick-study'] },
  { path: '/decks', key: 'decks', icon: BookOpen, match: ['/decks', '/templates'] },
  { path: '/brain', key: 'brain', icon: LayoutGrid, match: ['/brain'] },
]

/**
 * Phone and tablet: the four places people go most, one thumb away, and "메뉴" for everything
 * else. "메뉴" lights up on any page that is not one of the four, so the bar always says where
 * you are.
 */
export function BottomTabs({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const { t } = useTranslation('common')
  const { pathname } = useLocation()
  const onTab = TABS.some((tab) => tab.match.some((m) => isPathActive(pathname, m)))
  const itemClass = (active: boolean) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-xs no-underline transition-colors ${
      active ? 'text-brand-active font-semibold' : 'text-muted-foreground'
    }`
  return (
    <nav
      aria-label={t('nav.tabsLabel')}
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border flex pb-[env(safe-area-inset-bottom)]"
      data-testid="bottom-tabs"
    >
      {TABS.map((tab) => {
        const active = tab.match.some((m) => isPathActive(pathname, m))
        const Icon = tab.icon
        return (
          <Link key={tab.path} to={tab.path} aria-current={active ? 'page' : undefined} className={itemClass(active)} data-testid={`tab-${tab.key}`}>
            <Icon className="w-5 h-5" aria-hidden="true" />
            {t(`nav.short.${tab.key}`)}
          </Link>
        )
      })}
      <button
        type="button"
        onClick={onOpenMenu}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        className={`${itemClass(!onTab || menuOpen)} bg-transparent border-none cursor-pointer`}
        data-testid="tab-menu"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
        {t('nav.short.more')}
      </button>
    </nav>
  )
}

/** The full menu as a slide-over sheet, for widths without the sidebar. */
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('common')
  const closeRef = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()
  const lastPath = useRef(pathname)

  // Close when the route changes (a row was followed) and on Escape.
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname
      onClose()
    }
  }, [pathname, onClose])
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    // Where focus goes back to when the sheet closes (the button that opened it).
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab' || !panelRef.current) return
      // Keep Tab inside the sheet: it is modal, and the page behind it is covered.
      const items = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    // The sheet is `lg:hidden`: rotating a tablet to landscape hides it, so close it too — or the
    // scroll lock would stay on with nothing on screen to lift it.
    const wide = window.matchMedia('(min-width: 1024px)')
    const onWide = () => { if (wide.matches) onClose() }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => {
      window.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
      document.body.style.overflow = prevOverflow
      opener?.focus?.({ preventScroll: true })
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="lg:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={t('menu')} data-testid="menu-sheet">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={panelRef} className="absolute inset-y-0 left-0 w-[min(20rem,85vw)] bg-card shadow-xl flex flex-col pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-14 px-4">
          <Link to="/dashboard" onClick={onClose} className="flex items-center gap-2 no-underline">
            <img src="/favicon.png" alt="" className="w-8 h-8 object-contain" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-8 object-contain dark:brightness-0 dark:invert" />
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('actions.close')}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent bg-transparent border-none cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <SidebarContent onNavigate={onClose} />
        </div>
      </div>
    </div>
  )
}
