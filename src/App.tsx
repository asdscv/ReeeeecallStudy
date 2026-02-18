import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from './stores/auth-store'
import { LoginPage } from './components/auth/LoginPage'
import { AuthCallback } from './components/auth/AuthCallback'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { Layout } from './components/common/Layout'
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
      <Toaster richColors position="top-right" />
      <Routes>
        {/* Landing page (public) */}
        <Route path="/landing" element={<LandingPage />} />

        {/* Root: authenticated → dashboard, otherwise → redirect to landing */}
        <Route
          path="/"
          element={user ? (
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          ) : (
            <Navigate to="/landing" replace />
          )}
        >
          {user && <Route index element={<DashboardPage />} />}
        </Route>

        {/* Auth routes */}
        <Route
          path="/auth/login"
          element={user ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Public routes (no auth required) */}
        <Route path="/docs/api" element={<PublicApiDocsPage />} />
        <Route path="/content" element={<ContentListPage />} />
        <Route path="/content/:slug" element={<ContentDetailPage />} />
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

        {/* Fallback */}
        <Route path="*" element={<Navigate to={user ? '/' : '/landing'} replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
