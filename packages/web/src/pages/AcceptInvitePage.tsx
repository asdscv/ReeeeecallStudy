import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSharingStore } from '../stores/sharing-store'

export function AcceptInvitePage() {
  const { t } = useTranslation('sharing')
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const navigate = useNavigate()
  const { acceptInvite, error } = useSharingStore()

  const [loading, setLoading] = useState(false)
  const [accepted, setAccepted] = useState(false)

  const handleAccept = async () => {
    if (!inviteCode) return
    setLoading(true)
    const result = await acceptInvite(inviteCode)
    setLoading(false)

    if (result) {
      setAccepted(true)
      setTimeout(() => {
        navigate(`/decks/${result.deckId}`)
      }, 1500)
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8 max-w-md w-full text-center">
        {accepted ? (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{t('acceptInvite.accepted')}</h1>
            <p className="text-sm text-gray-500">{t('acceptInvite.redirecting')}</p>
          </>
        ) : (
          <>
            <div className="text-5xl mb-4">📨</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{t('acceptInvite.title')}</h1>
            <p className="text-sm text-gray-500 mb-6">
              {t('acceptInvite.inviteCode')}: <span className="font-mono font-medium text-gray-700">{inviteCode}</span>
            </p>

            {error && <p className="text-sm text-red-600 mb-4">{t(error)}</p>}

            <button
              onClick={handleAccept}
              disabled={loading}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? t('acceptInvite.accepting') : t('acceptInvite.accept')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
