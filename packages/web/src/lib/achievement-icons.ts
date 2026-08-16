/**
 * Achievement Icon System
 *
 * Maps achievement categories and IDs to Lucide icons with colored backgrounds.
 * Replaces emoji icons with consistent, professional Lucide icons.
 *
 * To add new icons: just add to CATEGORY_ICONS or SPECIAL_ICONS maps.
 *
 * Lookup only — the badge components live in components/achievements/AchievementIcon.tsx
 * so this module stays JSX-free and importable from non-UI code.
 */

import {
  Flame, BookOpen, Zap, Clock, Star, Package,
  HandHeart, Trophy, Target, Moon, Sun, Calendar,
  Award, Crown, Diamond, Medal, Shield,
  Bot, HelpCircle, PenLine, RotateCcw,
  type LucideIcon,
} from 'lucide-react'

export interface IconConfig {
  icon: LucideIcon
  bg: string     // Tailwind bg class
  color: string  // Tailwind text class
}

// Category-level defaults
const CATEGORY_ICONS: Record<string, IconConfig> = {
  streak:    { icon: Flame,     bg: 'bg-orange-100 dark:bg-orange-900/30', color: 'text-orange-500' },
  study:     { icon: BookOpen,  bg: 'bg-brand/15 dark:bg-blue-900/30',     color: 'text-brand' },
  social:    { icon: HandHeart, bg: 'bg-pink-100 dark:bg-pink-900/30',     color: 'text-pink-500' },
  milestone: { icon: Trophy,    bg: 'bg-warning/15 dark:bg-yellow-900/30', color: 'text-warning' },
  // Quizzes, generation and grading — mig 228. Without a row here the whole category fell back
  // to the milestone trophy, so three different kinds of AI badge looked identical.
  ai:        { icon: Bot,       bg: 'bg-violet-100 dark:bg-violet-900/30', color: 'text-violet-500' },
}

// Special achievement overrides (by prefix or exact ID)
const SPECIAL_ICONS: Record<string, IconConfig> = {
  // Streak tiers
  streak_diamond: { icon: Diamond, bg: 'bg-cyan-100 dark:bg-cyan-900/30', color: 'text-cyan-500' },
  streak_crown:   { icon: Crown,   bg: 'bg-purple-100 dark:bg-purple-900/30', color: 'text-purple-500' },

  // Study subtypes
  sessions:  { icon: Zap,      bg: 'bg-warning/15 dark:bg-amber-900/30',  color: 'text-warning' },
  time:      { icon: Clock,    bg: 'bg-teal-100 dark:bg-teal-900/30',    color: 'text-teal-500' },
  mastery:   { icon: Star,     bg: 'bg-indigo-100 dark:bg-indigo-900/30', color: 'text-indigo-500' },
  cards:     { icon: BookOpen,  bg: 'bg-brand/15 dark:bg-blue-900/30',    color: 'text-brand' },

  // Milestones
  decks:           { icon: Package, bg: 'bg-success/15 dark:bg-green-900/30', color: 'text-success' },
  first_deck:      { icon: Package, bg: 'bg-success/15 dark:bg-green-900/30', color: 'text-success' },
  perfect_session: { icon: Target,  bg: 'bg-emerald-100 dark:bg-emerald-900/30', color: 'text-emerald-500' },
  night_owl:       { icon: Moon,    bg: 'bg-violet-100 dark:bg-violet-900/30', color: 'text-violet-500' },
  early_bird:      { icon: Sun,     bg: 'bg-orange-100 dark:bg-orange-900/30', color: 'text-orange-400' },
  weekend_warrior: { icon: Calendar, bg: 'bg-rose-100 dark:bg-rose-900/30', color: 'text-rose-500' },

  // Social
  shares:          { icon: HandHeart, bg: 'bg-pink-100 dark:bg-pink-900/30', color: 'text-pink-500' },
  first_share:     { icon: HandHeart, bg: 'bg-pink-100 dark:bg-pink-900/30', color: 'text-pink-500' },
  reviews:         { icon: Star,     bg: 'bg-warning/15 dark:bg-yellow-900/30', color: 'text-warning' },
  first_review:    { icon: Star,     bg: 'bg-warning/15 dark:bg-yellow-900/30', color: 'text-warning' },
  market_acquire:  { icon: Award,    bg: 'bg-brand/15 dark:bg-blue-900/30', color: 'text-brand' },

  // AI
  quizzes:      { icon: HelpCircle, bg: 'bg-violet-100 dark:bg-violet-900/30', color: 'text-violet-500' },
  ai_cards:     { icon: Bot,        bg: 'bg-cyan-100 dark:bg-cyan-900/30',    color: 'text-cyan-500' },
  graded:       { icon: PenLine,    bg: 'bg-brand/15 dark:bg-blue-900/30',    color: 'text-brand' },
  perfect_quiz: { icon: Target,     bg: 'bg-emerald-100 dark:bg-emerald-900/30', color: 'text-emerald-500' },
  // The only badge that cannot be earned without going back to something you failed.
  comeback:     { icon: RotateCcw,  bg: 'bg-amber-100 dark:bg-amber-900/30',  color: 'text-amber-500' },
}

// Tier icons based on DB icon field (💎, 👑, 🏆)
const TIER_ICONS: Record<string, IconConfig> = {
  '💎': { icon: Diamond, bg: 'bg-cyan-100 dark:bg-cyan-900/30', color: 'text-cyan-500' },
  '👑': { icon: Crown,   bg: 'bg-purple-100 dark:bg-purple-900/30', color: 'text-purple-500' },
  '🏆': { icon: Trophy,  bg: 'bg-warning/15 dark:bg-yellow-900/30', color: 'text-warning' },
  '🏅': { icon: Medal,   bg: 'bg-warning/15 dark:bg-amber-900/30', color: 'text-warning' },
  '🛡️': { icon: Shield,  bg: 'bg-slate-100 dark:bg-slate-900/30', color: 'text-slate-500' },
}

/**
 * Get icon config for an achievement.
 * Priority: special ID match → tier icon → category default
 */
export function getAchievementIcon(
  id: string,
  category: string,
  dbIcon?: string,
): IconConfig {
  // 1. Exact ID match
  if (SPECIAL_ICONS[id]) return SPECIAL_ICONS[id]

  // 2. Prefix match (e.g. "sessions_50" → "sessions")
  const prefix = id.split('_')[0]
  if (SPECIAL_ICONS[prefix]) return SPECIAL_ICONS[prefix]

  // 3. Tier icon from DB (💎, 👑, etc.)
  if (dbIcon && TIER_ICONS[dbIcon]) return TIER_ICONS[dbIcon]

  // 4. Category default
  return CATEGORY_ICONS[category] ?? CATEGORY_ICONS.milestone
}

/**
 * Get category icon config
 */
export function getCategoryIcon(category: string): IconConfig {
  return CATEGORY_ICONS[category] ?? CATEGORY_ICONS.milestone
}
