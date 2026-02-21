import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '../../stores/auth-store'
import { localizeAuthError } from '../../lib/auth-errors'

export function ResetPasswordPage() {
  const { t } = useTranslation('auth')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const updatePassword = useAuthStore((s) => s.updatePassword)
  const session = useAuthStore((s) => s.session)
  const navigate = useNavigate()

  useEffect(() => {
    if (!session) {
      navigate('/auth/login', { replace: true })
    } else {
      setSessionChecked(true)
    }
  }, [session, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError(t('resetPassword.passwordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('resetPassword.passwordMismatch'))
      return
    }

    setLoading(true)
    const { error } = await updatePassword(password)
    setLoading(false)

    if (error) {
      setError(t(localizeAuthError(error.message)))
    } else {
      toast.success(t('resetPassword.success'))
      navigate('/dashboard', { replace: true })
    }
  }

  if (!sessionChecked) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-8">
            <Link to="/" aria-label="landing">
              <img src="/favicon.png" alt="" className="w-16 h-16 mx-auto mb-3" />
            </Link>
            <h2 className="text-xl font-bold text-gray-900">{t('resetPassword.title')}</h2>
            <p className="text-gray-500 mt-2">{t('resetPassword.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('resetPassword.newPasswordPlaceholder')}
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('resetPassword.confirmPasswordPlaceholder')}
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
            />

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password || !confirmPassword}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {loading ? t('resetPassword.changing') : t('resetPassword.changeButton')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
