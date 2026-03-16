export type ExitDirection = 'left' | 'right'

const LEFT_RATINGS = new Set(['again', 'hard', 'missed', 'unknown'])

export function getRatingExitDirection(rating: string): ExitDirection {
  return LEFT_RATINGS.has(rating) ? 'left' : 'right'
}
