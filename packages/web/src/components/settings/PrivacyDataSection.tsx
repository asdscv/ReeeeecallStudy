import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/auth-store'
import { isAnalyticsOptedOut, setAnalyticsOptOut } from '../../lib/analytics-consent'

// Privacy & data controls (GDPR): analytics opt-out (stops client-side telemetry) and
// self-serve account deletion (web parity with mobile — calls the same delete_user_account
// RPC). Deletion is immediate and irreversible; a two-step confirm guards a mis-click.
export function PrivacyDataSection() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const signOut = useAuthStore((s) => s.signOut)
  const [optedOut, setOptedOut] = useState(isAnalyticsOptedOut())
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const toggleTracking = () => {
    const next = !optedOut
    setAnalyticsOptOut(next)
    setOptedOut(next)
  }

  const deleteAccount = async () => {
    setDeleting(true)
    try {
      const { error } = await supabase.rpc('delete_user_account')
      if (error) {
        toast.error(t('privacy.deleteFailed'))
        setDeleting(false)
        return
      }
      await signOut()
      navigate('/')
    } catch {
      toast.error(t('privacy.deleteFailed'))
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{t('privacy.analyticsTitle')}</div>
          <div className="text-xs text-muted-foreground">{t('privacy.analyticsHint')}</div>
        </div>
        <button
          type="button"
          onClick={toggleTracking}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold min-w-[92px] cursor-pointer ${
            optedOut ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'
          }`}
        >
          {optedOut ? t('privacy.trackingOff') : t('privacy.trackingOn')}
        </button>
      </div>

      <div className="pt-3 border-t border-border">
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-sm text-destructive hover:underline cursor-pointer"
          >
            {t('privacy.deleteAccount')}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('privacy.deleteConfirm')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={deleteAccount}
                className="px-4 py-2 rounded-lg bg-destructive text-white text-sm cursor-pointer disabled:opacity-50"
              >
                {deleting ? '…' : t('privacy.deleteConfirmBtn')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirming(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm cursor-pointer"
              >
                {t('privacy.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
