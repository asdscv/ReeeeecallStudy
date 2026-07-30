import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'

// Module-level hash capture — executes synchronously on module load,
// before Supabase async processing can strip the URL hash via replaceState.
// Email link click = full page load → this module is freshly loaded.
let _capturedHash = window.location.hash

/** Override captured hash — for tests only */
export function _setCapturedHash(hash: string) {
  _capturedHash = hash
}

export function AuthCallback() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const navigatedRef = useRef(false)

  // Derive hash error synchronously during render — _capturedHash is module-level
  // and never changes, so this avoids an effect-based setState (cascading render).
  const params = _capturedHash ? new URLSearchParams(_capturedHash.substring(1)) : null
  const capturedType = params?.get('type') ?? null
  const hashErrorCode = params?.get('error_code') ?? null
  const hashErrorDesc = params?.get('error_description') ?? null
  const hashError = hashErrorCode
    ? t(`callback.errors.${hashErrorCode}`, { defaultValue: hashErrorDesc?.replace(/\+/g, ' ') || t('callback.errors.default') })
    : null

  const [error, setError] = useState<string | null>(hashError)

  useEffect(() => {
    // Hash error already derived at render time; skip subscription setup.
    if (hashErrorCode) return

    const isRecovery = capturedType === 'recovery'

    const safeNavigate = (path: string) => {
      if (navigatedRef.current) return
      navigatedRef.current = true
      navigate(path, { replace: true })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Highest priority: explicit recovery event
        safeNavigate('/auth/reset-password')
      } else if (event === 'SIGNED_IN') {
        if (isRecovery) {
          // Hash-based fallback: SIGNED_IN fired but hash says recovery
          safeNavigate('/auth/reset-password')
        } else {
          safeNavigate('/dashboard')
        }
      } else if (event === 'INITIAL_SESSION') {
        if (session) {
          if (isRecovery) {
            safeNavigate('/auth/reset-password')
          } else {
            // OAuth PKCE flow: session already established via code exchange
            safeNavigate('/dashboard')
          }
        }
        // No session → ignore, wait for SIGNED_IN/PASSWORD_RECOVERY
      }
    })

    const timeout = setTimeout(() => {
      if (!navigatedRef.current) {
        setError(t('callback.errors.timeout'))
      }
    }, 10000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [navigate, capturedType, hashErrorCode, t])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-foreground font-medium mb-2">{error}</p>
          <button
            onClick={() => navigate('/auth/login', { replace: true })}
            className="mt-4 px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover transition cursor-pointer"
          >
            {t('callback.backToLogin')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-spin">⏳</div>
        <p className="text-muted-foreground">{t('callback.processing')}</p>
      </div>
    </div>
  )
}
