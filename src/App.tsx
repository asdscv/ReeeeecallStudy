import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from './stores/auth-store'
import { LoginPage } from './components/auth/LoginPage'
import { AuthCallback } from './components/auth/AuthCallback'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { AdminRoute } from './components/auth/AdminRoute'
import { Layout } from './components/common/Layout'
import { AdminLayout } from './components/admin/AdminLayout'
import { DashboardPage } from './pages/DashboardPage'
import { DecksPage } from './pages/DecksPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { SettingsPage } from './pages/SettingsPage'
import { DeckDetailPage } from './pages/DeckDetailPage'
import { StudySetupPage } from './pages/StudySetupPage'
import { StudySessionPage } from './pages/StudySessionPage'
import { TemplateEditPage } from './pages/TemplateEditPage'
import { DeckEditPage } from './pages/DeckEditPage'
import { QuickStudyPage } from './pages/QuickStudyPage'
import { StudyHistoryPage } from './pages/StudyHistoryPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { MarketplaceDetailPage } from './pages/MarketplaceDetailPage'
import { DeckSharePage } from './pages/DeckSharePage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { MySharesPage } from './pages/MySharesPage'
import { GuidePage } from './pages/GuidePage'
import { ApiDocsPage } from './pages/ApiDocsPage'
import { PublicApiDocsPage } from './pages/PublicApiDocsPage'
import { ContentListPage } from './pages/ContentListPage'
import { ContentDetailPage } from './pages/ContentDetailPage'
import { LandingPage } from './pages/LandingPage'
import { PublicListingPage } from './pages/PublicListingPage'
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { AdminStudyPage } from './pages/admin/AdminStudyPage'
import { AdminContentPage } from './pages/admin/AdminContentPage'
import { AdminContentsPage } from './pages/admin/AdminContentsPage'
import { AdminSystemPage } from './pages/admin/AdminSystemPage'
import { usePageTracking } from './hooks/usePageTracking'

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

  useEffect(() => {
    initialize()
  }, [initialize])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <img src="/favicon.png" alt="" className="w-12 h-12 animate-pulse" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <PageTracker />
      <Toaster richColors position="top-right" />
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

        {/* Study session (outside Layout for fullscreen focus) */}
        <Route
          path="/decks/:deckId/study"
          element={
            <ProtectedRoute>
              <StudySessionPage />
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
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/:deckId" element={<DeckDetailPage />} />
          <Route path="/decks/:deckId/edit" element={<DeckEditPage />} />
          <Route path="/decks/:deckId/study/setup" element={<StudySetupPage />} />
          <Route path="/decks/:deckId/share" element={<DeckSharePage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/marketplace/:listingId" element={<MarketplaceDetailPage />} />
          <Route path="/invite/:inviteCode" element={<AcceptInvitePage />} />
          <Route path="/my-shares" element={<MySharesPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/:templateId/edit" element={<TemplateEditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/guide" element={<GuidePage />} />
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
            <Route path="contents" element={<AdminContentsPage />} />
            <Route path="system" element={<AdminSystemPage />} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to={user ? '/dashboard' : '/'} replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
