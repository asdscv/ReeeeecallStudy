import { X } from 'lucide-react'
import type { DeckShare } from '../../types/database'

interface SubscriberListProps {
  shares: DeckShare[]
  onRevoke: (shareId: string) => void
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: '대기 중', className: 'bg-yellow-50 text-yellow-700' },
  active: { label: '활성', className: 'bg-green-50 text-green-700' },
  revoked: { label: '취소됨', className: 'bg-red-50 text-red-700' },
  declined: { label: '거절됨', className: 'bg-gray-100 text-gray-500' },
}

export function SubscriberList({ shares, onRevoke }: SubscriberListProps) {
  if (shares.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500 text-sm">
        아직 공유한 사용자가 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {shares.map((share) => {
        const status = STATUS_LABELS[share.status] ?? STATUS_LABELS.pending

        return (
          <div
            key={share.id}
            className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-sm text-gray-900 truncate">
                  {share.invite_email || share.recipient_id || '초대 링크'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">{share.share_mode}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${status.className}`}>
                    {status.label}
                  </span>
                </div>
              </div>
            </div>

            {(share.status === 'pending' || share.status === 'active') && (
              <button
                onClick={() => onRevoke(share.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition cursor-pointer shrink-0"
                title="취소"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
