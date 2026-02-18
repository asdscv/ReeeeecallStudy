import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSharingStore } from '../stores/sharing-store'
import type { DeckShare } from '../types/database'

const STATUS_BADGE: Record<string, { labelKey: string; className: string }> = {
  pending: { labelKey: 'myShares.status.pending', className: 'bg-yellow-50 text-yellow-700' },
  active: { labelKey: 'myShares.status.active', className: 'bg-green-50 text-green-700' },
  revoked: { labelKey: 'myShares.status.revoked', className: 'bg-red-50 text-red-700' },
  declined: { labelKey: 'myShares.status.declined', className: 'bg-gray-100 text-gray-500' },
}

const MODE_KEY: Record<string, string> = {
  copy: 'myShares.mode.copy',
  subscribe: 'myShares.mode.subscribe',
  snapshot: 'myShares.mode.snapshot',
}

function ShareRow({ share, type, onAction }: { share: DeckShare; type: 'sent' | 'received'; onAction: (id: string) => void }) {
  const { t } = useTranslation('sharing')
  const status = STATUS_BADGE[share.status] ?? STATUS_BADGE.pending

  return (
    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
      <div className="min-w-0">
        <p className="text-sm text-gray-900 truncate">
          {share.invite_email || share.recipient_id || share.invite_code || 'N/A'}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-gray-400">{t(MODE_KEY[share.share_mode] ?? share.share_mode)}</span>
          <span className={`px-1.5 py-0.5 text-xs rounded-full ${status.className}`}>{t(status.labelKey)}</span>
        </div>
      </div>

      {share.status === 'active' && (
        <button
          onClick={() => onAction(share.id)}
          className="text-xs text-red-500 hover:text-red-600 cursor-pointer shrink-0 ml-3"
        >
          {type === 'sent' ? t('myShares.cancel') : t('myShares.unsubscribe')}
        </button>
      )}
    </div>
  )
}

export function MySharesPage() {
  const { t } = useTranslation('sharing')
  const { myShares, sharedWithMe, loading, fetchMyShares, fetchSharedWithMe, revokeShare, unsubscribe } = useSharingStore()

  useEffect(() => {
    fetchMyShares()
    fetchSharedWithMe()
  }, [fetchMyShares, fetchSharedWithMe])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">📤</div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">{t('myShares.title')}</h1>

      {/* Sent shares */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-3">{t('myShares.sent')}</h2>
        {myShares.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
            {t('myShares.noSent')}
          </div>
        ) : (
          <div className="space-y-2">
            {myShares.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                type="sent"
                onAction={revokeShare}
              />
            ))}
          </div>
        )}
      </section>

      {/* Received shares */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-3">{t('myShares.received')}</h2>
        {sharedWithMe.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
            {t('myShares.noReceived')}
          </div>
        ) : (
          <div className="space-y-2">
            {sharedWithMe.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                type="received"
                onAction={unsubscribe}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
