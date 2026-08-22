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
import { LearningTodayPage } from './pages/learning/LearningTodayPage'
import { QuizHomePage } from './pages/quiz/QuizHomePage'
import { QuizSetupPage } from './pages/quiz/QuizSetupPage'
import { LearningGoalsPage } from './pages/learning/LearningGoalsPage'
import { StudyHistoryPage } from './pages/StudyHistoryPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { DeckSharePage } from './pages/DeckSharePage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { MySharesPage } from './pages/MySharesPage'
import { PublisherDashboardPage } from './pages/PublisherDashboardPage'
import { GuidePage } from './pages/GuidePage'
import { ContentListPage } from './pages/ContentListPage'
import { ContentDetailPage } from './pages/ContentDetailPage'
import { LandingPage } from './pages/LandingPage'
import { PublicListingPage } from './pages/PublicListingPage'
import { TossCheckoutPage } from './pages/checkout/TossCheckoutPage'
import { TossReturnPage } from './pages/checkout/TossReturnPage'
import { usePageTracking } from './hooks/usePageTracking'
import { useTheme } from './hooks/useTheme'
import { useOnboardingStore } from './stores/onboarding-store'
import { OnboardingOverlay } from './components/onboarding/OnboardingOverlay'
import { LevelUpCelebration } from './components/common/LevelUpCelebration'
import { GlobalConfirmDialog } from './components/common/GlobalConfirmDialog'
import { captureAttribution } from './lib/attribution'

/* ------------------------------------------------------------------ */
/*  Lazy-loaded heavy pages                                           */
/* ------------------------------------------------------------------ */

// Study
// Taking a quiz is a focus surface like the study session: lazy, and outside Layout.
const QuizRunPage = lazy(() =>
  import('./pages/quiz/QuizRunPage').then(m => ({ default: m.QuizRunPage }))
)
const QuizMistakesPage = lazy(() =>
  import('./pages/quiz/QuizMistakesPage').then(m => ({ default: m.QuizMistakesPage }))
)
const QuizSetDetailPage = lazy(() =>
  import('./pages/quiz/QuizSetDetailPage').then(m => ({ default: m.QuizSetDetailPage }))
)
const QuizResultPage = lazy(() =>
  import('./pages/quiz/QuizResultPage').then(m => ({ default: m.QuizResultPage }))
)
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

// AI 학습 hub — the menu landing that lists every registered AI feature
const AIHubPage = lazy(() =>
  import('./pages/ai/AIHubPage').then(m => ({ default: m.AIHubPage }))
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
const AdminBillingPage = lazy(() =>
  import('./pages/admin/AdminBillingPage').then(m => ({ default: m.AdminBillingPage }))
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
  // 광고 파라미터는 착지 순간에만 URL 에 있다. 라우팅 한 번이면 사라지므로
  // 첫 렌더에서 붙들어 둔다.
  useEffect(() => {
    captureAttribution()
  }, [])
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
  // Key the session effects on the user ID, never the `user` object: a re-created
  // user object with the same id must not count as a new login, or a token refresh
  // silently re-registers and evicts the other client of this platform.
  const userId = user?.id ?? null

  const registerSession = useSubscriptionStore((s) => s.registerSession)
  const revalidateSession = useSubscriptionStore((s) => s.revalidateSession)
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

  // Register session + start heartbeat when user is logged in.
  // register 완료를 await한 뒤 heartbeat를 시작해 INSERT↔UPDATE race로 인한
  // 오인 킥(session_expired)을 방지한다.
  useEffect(() => {
    if (!userId) return
    let cleanup: (() => void) | undefined
    let cancelled = false
    void registerSession().then(() => {
      if (cancelled) return
      cleanup = startHeartbeat()
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [userId, registerSession, startHeartbeat])

  // When the tab becomes visible again, REVALIDATE — never re-register.
  // `registerSession` evicts the other client of this platform, so re-registering
  // on every visibility change made "coming back" mean "taking the session away",
  // and two clients ping-ponged: the one you are actually using stays visible and
  // so never fires the event to steal back, while the idle one fires it every time
  // its tab/window surfaces. A heartbeat revalidates without taking anything.
  // Claiming stays with an explicit login, a fresh page load, or the kicked
  // overlay's reclaim button.
  useEffect(() => {
    if (!userId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void revalidateSession()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId, revalidateSession])

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
      <GlobalConfirmDialog />
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
            <Route path="/insight" element={<ContentListPage />} />
            <Route path="/insight/:slug" element={<ContentDetailPage />} />
            <Route path="/d/:listingId" element={<PublicListingPage />} />
            <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

            {/* Guide — public, no auth required (with Layout for nav) */}
            <Route element={<Layout />}>
              <Route path="/guide" element={<GuidePage />} />
            </Route>

            {/* TossPayments checkout host + redirect landing (outside Layout — these
                run in the popup tab the billing store opened). Auth-gated: the confirm
                edge fns need the buyer's JWT. */}
            <Route
              path="/checkout/toss"
              element={
                <ProtectedRoute>
                  <TossCheckoutPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/checkout/toss/return"
              element={
                <ProtectedRoute>
                  <TossReturnPage />
                </ProtectedRoute>
              }
            />

            {/* Taking a quiz — outside Layout for the same reason the study session is:
                nothing on screen should compete with the question. */}
            <Route
              path="/quiz/:runId/run"
              element={
                <ProtectedRoute>
                  <StudyErrorBoundary>
                    <QuizRunPage />
                  </StudyErrorBoundary>
                </ProtectedRoute>
              }
            />

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
              {/* List -> detail. `/learning` is the plans; a plan opens at `/learning/:goalId`.
                  The old `/learning/insights` is gone: its only entry point was a small "진단"
                  link in the plan header, which is why nobody found it, and what it showed
                  belongs inside the plan it describes. */}
              <Route path="/learning" element={<LearningGoalsPage />} />
              <Route path="/learning/:goalId" element={<LearningTodayPage />} />
              {/* Quiz is its own menu, not a study mode: card study is six orderings of
                  show-flip-self-rate, and quiz is a different act entirely. */}
              <Route path="/quiz" element={<QuizHomePage />} />
              <Route path="/quiz/new" element={<QuizSetupPage />} />
              {/* `set/` in the path, not `/quiz/:setId` — the run routes already own a bare
                  id segment, and two id-shaped routes at the same depth is how a result URL
                  starts resolving as a set. */}
              <Route path="/quiz/mistakes" element={<QuizMistakesPage />} />
              <Route path="/quiz/set/:setId" element={<QuizSetDetailPage />} />
              <Route path="/quiz/:runId/result" element={<QuizResultPage />} />
              <Route path="/history" element={<StudyHistoryPage />} />
              <Route path="/history/detail" element={<SessionDetailPage />} />
              {/* The AI 학습 menu landing. The features keep their own URLs — this is the
                  index over them, not a prefix they moved under. */}
              <Route path="/ai" element={<AIHubPage />} />
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
                <Route path="billing" element={<AdminBillingPage />} />
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
