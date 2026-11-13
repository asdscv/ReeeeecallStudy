import { useCallback, useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { Menu, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAiHubEventBridge } from '../../hooks/useAiHubEventBridge'
import { AppDownload } from './AppDownload'
import { SidebarContent, BottomTabs, MenuSheet } from './AppNav'

export function Layout() {
  const { t } = useTranslation('common')
  // The one subscriber to the AI hub bus. Layout wraps every authenticated page, so this is
  // the only place it can be mounted once.
  useAiHubEventBridge()
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  return (
    <div className="min-h-screen bg-background">
      {/* Skip-to-content — first tab stop for keyboard/screen-reader users */}
      <a href="#main-content" className="skip-link no-underline">
        {t('skipToContent', 'Skip to content')}
      </a>

      {/* Desktop: the whole menu, always visible. */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col bg-card border-r border-border" data-testid="sidebar">
        <Link to="/dashboard" className="flex items-center gap-2 h-16 px-5 shrink-0 no-underline">
          <img src="/favicon.png" alt="" className="w-9 h-9 object-contain" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-9 object-contain dark:brightness-0 dark:invert" />
        </Link>
        <div className="flex-1 min-h-0">
          <SidebarContent />
        </div>
      </aside>

      {/* Phone / tablet: a slim bar on top, tabs at the bottom, the full menu in a sheet. */}
      <header className="lg:hidden bg-card border-b border-border sticky top-0 z-40">
        <div className="px-2 h-14 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2 px-2 no-underline">
            <img src="/favicon.png" alt="" className="w-8 h-8 object-contain" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-8 object-contain dark:brightness-0 dark:invert" />
          </Link>
          <div className="flex items-center">
            <Link
              to="/guide"
              aria-label={t('nav.guide')}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent no-underline"
            >
              <BookOpen className="w-5 h-5" aria-hidden="true" />
            </Link>
            <button
              type="button"
              aria-label={t('menu')}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent bg-transparent border-none cursor-pointer"
              data-testid="header-menu"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <MenuSheet open={menuOpen} onClose={closeMenu} />

      <div className="lg:pl-60">
        {/* Main Content */}
        <main id="main-content" tabIndex={-1} className="max-w-6xl mx-auto px-4 py-4 sm:py-6 outline-none">
          <Outlet />
        </main>

        {/* Footer — padded on phones so the tab bar never covers it. */}
        <footer className="border-t border-border bg-background pb-24 lg:pb-0">
          <div className="max-w-6xl mx-auto px-4 py-10 sm:py-12">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
              <div className="flex items-center gap-2">
                <img src="/favicon.png" alt="" className="w-7 h-7" />
                <span className="font-bold text-foreground">ReeeeecallStudy</span>
              </div>
              <AppDownload />
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground">
                {t('footer.copyright', '© 2026 ReeeeecallStudy. All rights reserved.')}
              </p>
              <a href="mailto:admin@reeeeecallstudy.xyz" className="text-sm text-muted-foreground hover:text-foreground transition no-underline">
                admin@reeeeecallstudy.xyz
              </a>
            </div>
          </div>
        </footer>
      </div>

      <BottomTabs onOpenMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
    </div>
  )
}
