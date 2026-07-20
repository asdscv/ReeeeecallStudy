import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../common/Modal'
import { useDeckStore } from '../../stores/deck-store'
import { CardUsagePanel } from './CardUsagePanel'
import { PlanSelector } from './PlanSelector'

/**
 * Full card-storage detail, in a modal. Opened from the dashboard usage card and
 * anywhere an at-a-glance meter wants a "details" affordance. Reads the detailed
 * breakdown from the shared deck-store and force-refreshes on open so the numbers are
 * live. Includes the upgrade PlanSelector (gated by the payments flag inside it).
 */
export function CardUsageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const detail = useDeckStore((s) => s.cardUsageDetail)
  const fetchDetail = useDeckStore((s) => s.fetchCardUsageDetail)

  useEffect(() => {
    if (open) void fetchDetail({ force: true })
  }, [open, fetchDetail])

  return (
    <Modal open={open} onClose={onClose} title={t('cardUsage.detail.title', 'Card storage')} maxWidth="max-w-md">
      {detail ? (
        <CardUsagePanel detail={detail} />
      ) : (
        <div className="h-24 animate-pulse rounded-xl bg-accent" aria-hidden />
      )}
      <div className="mt-5 border-t border-border pt-4">
        <PlanSelector />
      </div>
    </Modal>
  )
}
