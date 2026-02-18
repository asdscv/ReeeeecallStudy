import {
  Brain,
  Zap,
  Target,
  BookOpen,
  Clock,
  TrendingUp,
  Award,
  Star,
  Heart,
  Lightbulb,
  Puzzle,
  Repeat,
  CheckCircle2,
  BarChart3,
  Globe,
  Layers,
  Share2,
  Smartphone,
  Shield,
  Rocket,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { createElement, type ReactNode } from 'react'

// Curated icon map for FeatureCards block
export const CONTENT_ICON_MAP: Record<string, LucideIcon> = {
  brain: Brain,
  zap: Zap,
  target: Target,
  'book-open': BookOpen,
  clock: Clock,
  'trending-up': TrendingUp,
  award: Award,
  star: Star,
  heart: Heart,
  lightbulb: Lightbulb,
  puzzle: Puzzle,
  repeat: Repeat,
  'check-circle': CheckCircle2,
  'bar-chart': BarChart3,
  globe: Globe,
  layers: Layers,
  share: Share2,
  smartphone: Smartphone,
  shield: Shield,
  rocket: Rocket,
}

// Inline markdown parser — converts simple markdown to React elements
// Supports: **bold**, *italic*, [link](url)
export function parseInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/)
    // Italic: *text*
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/)
    // Link: [text](url)
    const linkMatch = remaining.match(/^(.*?)\[(.+?)\]\((.+?)\)/)

    // Find earliest match
    const matches = [
      boldMatch ? { type: 'bold' as const, index: boldMatch[1].length, match: boldMatch } : null,
      italicMatch && (!boldMatch || italicMatch[1].length < boldMatch[1].length)
        ? { type: 'italic' as const, index: italicMatch[1].length, match: italicMatch }
        : null,
      linkMatch ? { type: 'link' as const, index: linkMatch[1].length, match: linkMatch } : null,
    ].filter(Boolean) as Array<{ type: 'bold' | 'italic' | 'link'; index: number; match: RegExpMatchArray }>

    if (matches.length === 0) {
      nodes.push(remaining)
      break
    }

    // Sort by position
    matches.sort((a, b) => a.index - b.index)
    const earliest = matches[0]

    // Add text before match
    if (earliest.match[1]) {
      nodes.push(earliest.match[1])
    }

    switch (earliest.type) {
      case 'bold':
        nodes.push(createElement('strong', { key: key++, className: 'font-bold' }, earliest.match[2]))
        remaining = remaining.slice(earliest.match[0].length)
        break
      case 'italic':
        nodes.push(createElement('em', { key: key++, className: 'italic' }, earliest.match[2]))
        remaining = remaining.slice(earliest.match[0].length)
        break
      case 'link':
        nodes.push(
          createElement(
            'a',
            {
              key: key++,
              href: earliest.match[3],
              className: 'text-blue-600 hover:underline',
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            earliest.match[2],
          ),
        )
        remaining = remaining.slice(earliest.match[0].length)
        break
    }
  }

  return nodes
}
