import { useTranslation } from 'react-i18next'
import type { Deck } from '../../types/database'

interface ShareBadgeProps {
  deck: Deck
  userId: string
}

export function ShareBadge({ deck }: ShareBadgeProps) {
  const { t } = useTranslation('sharing')

  if (!deck.share_mode || !deck.source_owner_id) return null

  const config: Record<string, { labelKey: string; className: string }> = {
    subscribe: { labelKey: 'mode.subscribe', className: 'bg-purple-50 text-purple-700' },
    snapshot: { labelKey: 'mode.snapshot', className: 'bg-orange-50 text-orange-700' },
    copy: { labelKey: 'mode.copy', className: 'bg-teal-50 text-teal-700' },
  }

  const c = config[deck.share_mode]
  if (!c) return null

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${c.className}`}>
      {t(c.labelKey)}
    </span>
  )
}
