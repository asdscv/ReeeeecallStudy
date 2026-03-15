import { useAuthStore } from '../../stores/auth-store'
import { AuthGuardOverlay } from './AuthGuardOverlay'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-4xl animate-pulse">📚</div>
      </div>
    )
  }

  if (!user) {
    return <AuthGuardOverlay />
  }

  return <>{children}</>
}
