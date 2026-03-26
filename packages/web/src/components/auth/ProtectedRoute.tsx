import { useAuthStore } from '../../stores/auth-store'
import { AuthGuardOverlay } from './AuthGuardOverlay'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0f172a] overflow-hidden relative">
      {/* Floating orbs */}
      <div className="absolute w-40 h-40 rounded-full bg-blue-500/15 blur-2xl top-1/4 left-[15%] animate-pulse" style={{ animationDuration: '8s' }} />
      <div className="absolute w-32 h-32 rounded-full bg-purple-500/12 blur-2xl top-[15%] right-[20%] animate-pulse" style={{ animationDuration: '10s' }} />
      <div className="absolute w-44 h-44 rounded-full bg-cyan-400/10 blur-2xl bottom-1/4 left-1/2 -translate-x-1/2 animate-pulse" style={{ animationDuration: '12s' }} />

      {/* Logo with glow */}
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="relative">
          <div className="absolute inset-0 w-20 h-20 rounded-full bg-blue-500/20 blur-xl scale-150" />
          <img src="/favicon.png" alt="" className="w-20 h-20 relative z-10 animate-pulse" style={{ animationDuration: '4s' }} />
        </div>
        <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-7 brightness-0 invert opacity-80" />
        <p className="text-sm text-slate-400/80 tracking-wide">Smart flashcards, powered by AI</p>

        {/* Loading dots */}
        <div className="flex gap-1.5 mt-1">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()

  if (loading) {
    return <LoadingScreen />
  }

  if (!user) {
    return <AuthGuardOverlay />
  }

  return <>{children}</>
}
