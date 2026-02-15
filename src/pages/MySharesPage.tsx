import { useEffect } from 'react'
import { useSharingStore } from '../stores/sharing-store'
import type { DeckShare } from '../types/database'

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '대기 중', className: 'bg-yellow-50 text-yellow-700' },
  active: { label: '활성', className: 'bg-green-50 text-green-700' },
  revoked: { label: '취소됨', className: 'bg-red-50 text-red-700' },
  declined: { label: '거절됨', className: 'bg-gray-100 text-gray-500' },
}

const MODE_LABEL: Record<string, string> = {
  copy: '복사',
  subscribe: '구독',
  snapshot: '스냅샷',
}

function ShareRow({ share, type, onAction }: { share: DeckShare; type: 'sent' | 'received'; onAction: (id: string) => void }) {
  const status = STATUS_BADGE[share.status] ?? STATUS_BADGE.pending

  return (
    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
      <div className="min-w-0">
        <p className="text-sm text-gray-900 truncate">
          {share.invite_email || share.recipient_id || share.invite_code || 'N/A'}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-gray-400">{MODE_LABEL[share.share_mode] ?? share.share_mode}</span>
          <span className={`px-1.5 py-0.5 text-xs rounded-full ${status.className}`}>{status.label}</span>
        </div>
      </div>

      {share.status === 'active' && (
        <button
          onClick={() => onAction(share.id)}
          className="text-xs text-red-500 hover:text-red-600 cursor-pointer shrink-0 ml-3"
        >
          {type === 'sent' ? '취소' : '구독 해지'}
        </button>
      )}
    </div>
  )
}

export function MySharesPage() {
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
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">내 공유 현황</h1>

      {/* Sent shares */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-3">보낸 공유</h2>
        {myShares.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
            아직 공유한 덱이 없습니다.
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
        <h2 className="text-base font-semibold text-gray-900 mb-3">받은 공유</h2>
        {sharedWithMe.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
            아직 받은 공유가 없습니다.
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
