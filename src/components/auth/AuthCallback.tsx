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
  const [error, setError] = useState<string | null>(null)
  const navigatedRef = useRef(false)

  useEffect(() => {
    const params = _capturedHash ? new URLSearchParams(_capturedHash.substring(1)) : null
    const capturedType = params?.get('type') ?? null

    // Check for error in hash params
    if (params) {
      const errorCode = params.get('error_code')
      const errorDesc = params.get('error_description')

      if (errorCode) {
        const errorKey = `callback.errors.${errorCode}`
        setError(t(errorKey, { defaultValue: errorDesc?.replace(/\+/g, ' ') || t('callback.errors.default') }))
        return
      }
    }

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
          safeNavigate('/')
        }
      } else if (event === 'INITIAL_SESSION') {
        if (isRecovery && session) {
          // Fallback: hash tokens already processed, session exists
          safeNavigate('/auth/reset-password')
        }
        // No session or non-recovery → ignore, wait for SIGNED_IN/PASSWORD_RECOVERY
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
  }, [navigate])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-gray-900 font-medium mb-2">{error}</p>
          <button
            onClick={() => navigate('/auth/login', { replace: true })}
            className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer"
          >
            {t('callback.backToLogin')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-4xl mb-4 animate-spin">⏳</div>
        <p className="text-gray-500">{t('callback.processing')}</p>
      </div>
    </div>
  )
}
