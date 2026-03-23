import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { DeckShare } from '../../types/database'

interface SubscriberListProps {
  shares: DeckShare[]
  onRevoke: (shareId: string) => void
}

export function SubscriberList({ shares, onRevoke }: SubscriberListProps) {
  const { t } = useTranslation('sharing')

  const STATUS_LABELS: Record<string, { labelKey: string; className: string }> = {
    pending: { labelKey: 'status.pending', className: 'bg-warning/10 text-warning' },
    active: { labelKey: 'status.active', className: 'bg-success/10 text-success' },
    revoked: { labelKey: 'status.revoked', className: 'bg-destructive/10 text-destructive' },
    declined: { labelKey: 'status.declined', className: 'bg-accent text-muted-foreground' },
  }

  if (shares.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        {t('noSubscribers')}
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
            className="flex items-center justify-between p-3 bg-card rounded-lg border border-border"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">
                  {share.invite_email || share.recipient_id || t('inviteLink')}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-content-tertiary">{t(`mode.${share.share_mode}`)}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${status.className}`}>
                    {t(status.labelKey)}
                  </span>
                </div>
              </div>
            </div>

            {(share.status === 'pending' || share.status === 'active') && (
              <button
                onClick={() => onRevoke(share.id)}
                className="p-1.5 text-content-tertiary hover:text-destructive hover:bg-destructive/10 rounded-lg transition cursor-pointer shrink-0"
                title={t('cancel')}
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
