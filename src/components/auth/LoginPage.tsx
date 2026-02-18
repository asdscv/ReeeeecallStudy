import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../stores/auth-store'
import { localizeAuthError } from '../../lib/auth-errors'

type Mode = 'login' | 'signup' | 'forgot'

export function LoginPage() {
  const { t } = useTranslation('auth')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('login')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const resetPassword = useAuthStore((s) => s.resetPassword)
  const navigate = useNavigate()

  const switchMode = (newMode: Mode) => {
    setMode(newMode)
    setError(null)
    setSuccessMessage(null)
    setPassword('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (mode === 'forgot') {
      const { error } = await resetPassword(email)
      setLoading(false)
      if (error) {
        setError(t(localizeAuthError(error.message) as string))
      } else {
        setSuccessMessage(t('resetLinkSent'))
      }
      return
    }

    if (mode === 'signup') {
      if (password.length < 6) {
        setError(t('resetPassword.passwordTooShort'))
        setLoading(false)
        return
      }
      const { error } = await signUp(email, password)
      setLoading(false)
      if (error) {
        setError(t(localizeAuthError(error.message) as string))
      } else {
        setSuccessMessage(t('emailVerification.signupSuccess'))
      }
      return
    }

    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(t(localizeAuthError(error.message) as string))
    } else {
      navigate('/', { replace: true })
    }
  }

  if (successMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4 text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
            <div className="text-5xl mb-4">📧</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{t('emailVerification.title')}</h2>
            <p className="text-gray-500 mb-2">
              <span className="font-medium text-gray-700">{email}</span>
            </p>
            <p className="text-gray-500 mb-6">{successMessage}</p>
            <button
              onClick={() => switchMode('login')}
              className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              {t('emailVerification.backToLogin')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const title = { login: t('loginTitle'), signup: t('signupTitle'), forgot: t('forgotPasswordTitle') }[mode]
  const submitLabel = { login: t('loginButton'), signup: t('signupButton'), forgot: t('sendResetLink') }[mode]
  const loadingLabel = { login: t('loggingIn'), signup: t('signingUp'), forgot: t('sending') }[mode]

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <img src="/favicon.png" alt="" className="w-16 h-16 mx-auto mb-3" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-10 mx-auto" />
            <p className="text-gray-500 mt-3">{title}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
            />

            {mode !== 'forgot' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('passwordPlaceholder')}
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
              />
            )}

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            {mode === 'login' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm text-gray-400 hover:text-blue-600 cursor-pointer"
                >
                  {t('forgotPasswordLink')}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || (mode !== 'forgot' && !password)}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {loading ? loadingLabel : submitLabel}
            </button>
          </form>

          <div className="text-sm text-center mt-6 text-gray-500 space-y-1">
            {mode === 'forgot' ? (
              <button
                onClick={() => switchMode('login')}
                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
              >
                {t('backToLogin')}
              </button>
            ) : (
              <p>
                {mode === 'signup' ? t('alreadyHaveAccount') : t('noAccount')}{' '}
                <button
                  onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}
                  className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                >
                  {mode === 'signup' ? t('login') : t('signup')}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
