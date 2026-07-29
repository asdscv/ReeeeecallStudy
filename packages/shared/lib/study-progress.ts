import type { StudyMode } from '../types/database'

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function calculateStudyProgress(
  mode: StudyMode,
  cardsStudied: number,
  totalCards: number,
  crammingMasteryPercentage?: number,
): number {
  if (!Number.isFinite(cardsStudied) || !Number.isFinite(totalCards) || totalCards <= 0) {
    return 0
  }

  if (mode === 'cramming' && crammingMasteryPercentage !== undefined) {
    return clampPercentage(crammingMasteryPercentage)
  }

  return clampPercentage((cardsStudied / totalCards) * 100)
}
