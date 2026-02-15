import type { Deck } from '../../types/database'

interface ShareBadgeProps {
  deck: Deck
  userId: string
}

export function ShareBadge({ deck }: ShareBadgeProps) {
  if (!deck.share_mode || !deck.source_owner_id) return null

  const config: Record<string, { label: string; className: string }> = {
    subscribe: { label: '구독 중', className: 'bg-purple-50 text-purple-700' },
    snapshot: { label: '스냅샷', className: 'bg-orange-50 text-orange-700' },
    copy: { label: '복사본', className: 'bg-teal-50 text-teal-700' },
  }

  const c = config[deck.share_mode]
  if (!c) return null

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${c.className}`}>
      {c.label}
    </span>
  )
}
