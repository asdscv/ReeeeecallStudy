import type { BrainColor } from '../types'
import { choiceGame } from './choice'

/**
 * A colour word printed in a different ink. Pick the INK — or, after a rule switch, the word.
 * Inhibition: reading is automatic, and the task is to not do it.
 */
export const BRAIN_COLORS: readonly BrainColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange']

export const stroop = choiceGame('stroop', (level, rng) => {
  const optionCount = Math.min(BRAIN_COLORS.length, 2 + Math.floor((level + 1) / 3))
  const word = rng.pick(BRAIN_COLORS)
  const incongruent = rng.chance(Math.min(0.9, 0.5 + level * 0.03))
  const ink = incongruent ? rng.pick(BRAIN_COLORS.filter((c) => c !== word)) : word
  const rule: 'ink' | 'word' = level >= 8 && rng.chance(0.3) ? 'word' : 'ink'
  const answer = rule === 'ink' ? ink : word
  const required = [...new Set([word, ink])]
  const rest = rng.sample(BRAIN_COLORS.filter((c) => !required.includes(c)), optionCount - required.length)
  const colors = rng.shuffle([...required, ...rest])
  return {
    prompt: { key: rule === 'ink' ? 'play.pickInk' : 'play.pickWord' },
    stimulus: { textKey: `colors.${word}`, color: ink },
    options: colors.map((c) => ({ textKey: `colors.${c}` })),
    correctIndex: colors.indexOf(answer),
    // Six colours and the rule switch are in by level 15; the clock reaches its 1.4s floor at 30,
    // where the game stops getting harder (maxLevel).
    limitMs: Math.max(1400, 5200 - level * 130),
    picked: null,
    timedOut: false,
    sig: `st:${rule}:${word}:${ink}:${colors.join(',')}`,
  }
}, { maxLevel: 30 })
