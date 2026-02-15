import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from './stores/auth-store'
import { LoginPage } from './components/auth/LoginPage'
import { AuthCallback } from './components/auth/AuthCallback'
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

function App() {
  const { initialize, user, loading } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-4xl animate-pulse">📚</div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Toaster richColors position="top-right" />
      <Routes>
        {/* Auth routes */}
        <Route
          path="/auth/login"
          element={user ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route path="/auth/callback" element={<AuthCallback />} />

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
          <Route path="/" element={<DashboardPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/:deckId" element={<DeckDetailPage />} />
          <Route path="/decks/:deckId/edit" element={<DeckEditPage />} />
          <Route path="/decks/:deckId/study/setup" element={<StudySetupPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/:templateId/edit" element={<TemplateEditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
