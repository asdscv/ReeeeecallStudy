export type SessionSummaryType = 'no-cards' | 'partial' | 'complete'

export function getSessionSummaryType(
  totalCards: number,
  cardsStudied: number,
): SessionSummaryType {
  if (totalCards === 0) return 'no-cards'
  if (cardsStudied < totalCards) return 'partial'
  return 'complete'
}
