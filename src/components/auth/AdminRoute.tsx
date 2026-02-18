import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth-store'

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, role } = useAuthStore()

  // Show loading while auth or role is still resolving
  if (loading || (user && role === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <img src="/favicon.png" alt="" className="w-12 h-12 animate-pulse" />
      </div>
    )
  }

  if (!user || role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
