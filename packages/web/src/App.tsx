import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from './stores/auth-store'
import { useSubscriptionStore } from './stores/subscription-store'
import { SessionKickedOverlay } from './components/auth/SessionKickedOverlay'
import { LoginPage } from './components/auth/LoginPage'
import { AuthCallback } from './components/auth/AuthCallback'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { AdminRoute } from './components/auth/AdminRoute'
import { Layout } from './components/common/Layout'
import { ErrorBoundary, StudyErrorBoundary } from './components/common/ErrorBoundary'
import { AdminLayout } from './components/admin/AdminLayout'
import { DashboardPage } from './pages/DashboardPage'
import { DecksPage } from './pages/DecksPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { SettingsPage } from './pages/SettingsPage'
import { DeckDetailPage } from './pages/DeckDetailPage'
import { StudySetupPage } from './pages/StudySetupPage'
import { TemplateEditPage } from './pages/TemplateEditPage'
import { QuickStudyPage } from './pages/QuickStudyPage'
import { StudyHistoryPage } from './pages/StudyHistoryPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { DeckSharePage } from './pages/DeckSharePage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { MySharesPage } from './pages/MySharesPage'
import { PublisherDashboardPage } from './pages/PublisherDashboardPage'
import { GuidePage } from './pages/GuidePage'
import { ApiDocsPage } from './pages/ApiDocsPage'
import { PublicApiDocsPage } from './pages/PublicApiDocsPage'
import { ContentListPage } from './pages/ContentListPage'
import { ContentDetailPage } from './pages/ContentDetailPage'
import { LandingPage } from './pages/LandingPage'
import { PublicListingPage } from './pages/PublicListingPage'
import { usePageTracking } from './hooks/usePageTracking'
import { useTheme } from './hooks/useTheme'
import { useOnboardingStore } from './stores/onboarding-store'
import { OnboardingOverlay } from './components/onboarding/OnboardingOverlay'
import { LevelUpCelebration } from './components/common/LevelUpCelebration'

/* ------------------------------------------------------------------ */
/*  Lazy-loaded heavy pages                                           */
/* ------------------------------------------------------------------ */

// Study
const StudySessionPage = lazy(() =>
  import('./pages/StudySessionPage').then(m => ({ default: m.StudySessionPage }))
)

// Marketplace
const MarketplacePage = lazy(() =>
  import('./pages/MarketplacePage').then(m => ({ default: m.MarketplacePage }))
)
const MarketplaceDetailPage = lazy(() =>
  import('./pages/MarketplaceDetailPage').then(m => ({ default: m.MarketplaceDetailPage }))
)

// AI Generate
const AIGeneratePage = lazy(() =>
  import('./pages/AIGeneratePage').then(m => ({ default: m.AIGeneratePage }))
)

// Deck Edit
const DeckEditPage = lazy(() =>
  import('./pages/DeckEditPage').then(m => ({ default: m.DeckEditPage }))
)

// Achievements (includes leaderboard tab)
const AchievementsPage = lazy(() =>
  import('./pages/AchievementsPage').then(m => ({ default: m.AchievementsPage }))
)

// Admin pages
const AdminOverviewPage = lazy(() =>
  import('./pages/admin/AdminOverviewPage').then(m => ({ default: m.AdminOverviewPage }))
)
const AdminUsersPage = lazy(() =>
  import('./pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage }))
)
const AdminStudyPage = lazy(() =>
  import('./pages/admin/AdminStudyPage').then(m => ({ default: m.AdminStudyPage }))
)
const AdminContentPage = lazy(() =>
  import('./pages/admin/AdminContentPage').then(m => ({ default: m.AdminContentPage }))
)
const AdminContentsPage = lazy(() =>
  import('./pages/admin/AdminContentsPage').then(m => ({ default: m.AdminContentsPage }))
)
const AdminSystemPage = lazy(() =>
  import('./pages/admin/AdminSystemPage').then(m => ({ default: m.AdminSystemPage }))
)
const AdminOfficialPage = lazy(() =>
  import('./pages/admin/AdminOfficialPage').then(m => ({ default: m.AdminOfficialPage }))
)
const AdminAuditPage = lazy(() =>
  import('./pages/admin/AdminAuditPage').then(m => ({ default: m.AdminAuditPage }))
)

/* ------------------------------------------------------------------ */
/*  Loading fallback                                                  */
/* ------------------------------------------------------------------ */

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function PageTracker() {
  usePageTracking()
  return null
}

/** Redirect already-logged-in users visiting /auth/login, respecting ?redirect= param */
function LoginRedirect() {
  const params = new URLSearchParams(window.location.search)
  const redirectTo = params.get('redirect') || '/dashboard'
  // Only allow same-origin relative paths (must start with / followed by alphanumeric)
  const safePath = /^\/[a-zA-Z0-9]/.test(redirectTo) ? redirectTo : '/dashboard'
  return <Navigate to={safePath} replace />
}

function App() {
  const { initialize, user, loading } = useAuthStore()
  const startHeartbeat = useSubscriptionStore((s) => s.startHeartbeat)
  const { showOnboarding, initialize: initOnboarding } = useOnboardingStore()

  // Apply theme (dark class on <html>) based on user preference / system setting
  useTheme()

  useEffect(() => {
    initialize()
  }, [initialize])

  // Initialize onboarding when user is logged in
  useEffect(() => {
    if (user) initOnboarding()
  }, [user, initOnboarding])

  // Start session heartbeat when user is logged in
  useEffect(() => {
    if (!user) return
    const cleanup = startHeartbeat()
    return cleanup
  }, [user, startHeartbeat])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <img src="/favicon.png" alt="" className="w-12 h-12 animate-pulse" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <PageTracker />
      <SessionKickedOverlay />
      <Toaster richColors position="top-right" />
      <ErrorBoundary>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            {/* Root: landing for guests, dashboard for logged-in users */}
            <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
            {/* /landing always shows landing page regardless of auth */}
            <Route path="/landing" element={<LandingPage />} />

            {/* Auth routes */}
            <Route
              path="/auth/login"
              element={user ? <LoginRedirect /> : <LoginPage />}
            />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Public routes (no auth required) */}
            <Route path="/docs/api" element={<PublicApiDocsPage />} />
            <Route path="/insight" element={<ContentListPage />} />
            <Route path="/insight/:slug" element={<ContentDetailPage />} />
            <Route path="/d/:listingId" element={<PublicListingPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

            {/* Guide — public, no auth required (with Layout for nav) */}
            <Route element={<Layout />}>
              <Route path="/guide" element={<GuidePage />} />
            </Route>

            {/* Study session (outside Layout for fullscreen focus) */}
            <Route
              path="/decks/:deckId/study"
              element={
                <ProtectedRoute>
                  <StudyErrorBoundary>
                    <StudySessionPage />
                  </StudyErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Protected routes */}
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/quick-study" element={<QuickStudyPage />} />
              <Route path="/history" element={<StudyHistoryPage />} />
              <Route path="/history/detail" element={<SessionDetailPage />} />
              <Route path="/ai-generate" element={<AIGeneratePage />} />
              <Route path="/decks" element={<DecksPage />} />
              <Route path="/decks/:deckId" element={<DeckDetailPage />} />
              <Route path="/decks/:deckId/edit" element={<DeckEditPage />} />
              <Route
                path="/decks/:deckId/study/setup"
                element={
                  <StudyErrorBoundary>
                    <StudySetupPage />
                  </StudyErrorBoundary>
                }
              />
              <Route path="/decks/:deckId/share" element={<DeckSharePage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="/marketplace/:listingId" element={<MarketplaceDetailPage />} />
              <Route path="/invite/:inviteCode" element={<AcceptInvitePage />} />
              <Route path="/my-shares" element={<MySharesPage />} />
              <Route path="/publisher" element={<PublisherDashboardPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/templates/:templateId/edit" element={<TemplateEditPage />} />
              <Route path="/achievements" element={<AchievementsPage />} />
              <Route path="/leaderboard" element={<Navigate to="/achievements" replace />} />
              <Route path="/analytics" element={<Navigate to="/history" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/api-docs" element={<ApiDocsPage />} />
            </Route>

            {/* Admin routes */}
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <Layout />
                </AdminRoute>
              }
            >
              <Route element={<AdminLayout />}>
                <Route index element={<AdminOverviewPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="study" element={<AdminStudyPage />} />
                <Route path="market" element={<AdminContentPage />} />
                <Route path="official" element={<AdminOfficialPage />} />
                <Route path="contents" element={<AdminContentsPage />} />
                <Route path="system" element={<AdminSystemPage />} />
                <Route path="audit" element={<AdminAuditPage />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
          </Routes>
        </Suspense>
        {showOnboarding && <OnboardingOverlay />}
        {user && <LevelUpCelebration />}
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
