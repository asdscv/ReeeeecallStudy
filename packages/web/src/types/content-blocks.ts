// Content block type definitions for the block-based content system
// AI generates content as an array of these blocks

export type ContentBlock =
  | HeroBlock
  | ParagraphBlock
  | HeadingBlock
  | BlockquoteBlock
  | StatisticsBlock
  | FeatureCardsBlock
  | NumberedListBlock
  | HighlightBoxBlock
  | ImageBlock
  | DividerBlock
  | CtaBlock

export interface HeroBlock {
  type: 'hero'
  props: {
    title: string
    subtitle?: string
    date?: string
    readingTime?: number
  }
}

export interface ParagraphBlock {
  type: 'paragraph'
  props: {
    text: string
  }
}

export interface HeadingBlock {
  type: 'heading'
  props: {
    level: 2 | 3
    text: string
    accent?: boolean
  }
}

export interface BlockquoteBlock {
  type: 'blockquote'
  props: {
    text: string
    attribution?: string
  }
}

export interface StatisticsBlock {
  type: 'statistics'
  props: {
    items: Array<{
      value: string
      label: string
    }>
  }
}

export interface FeatureCardsBlock {
  type: 'feature_cards'
  props: {
    items: Array<{
      icon: string
      title: string
      description: string
      color: string
    }>
  }
}

export interface NumberedListBlock {
  type: 'numbered_list'
  props: {
    items: Array<{
      heading: string
      description: string
    }>
  }
}

export interface HighlightBoxBlock {
  type: 'highlight_box'
  props: {
    title: string
    description: string
    variant?: 'blue' | 'green' | 'amber'
  }
}

export interface ImageBlock {
  type: 'image'
  props: {
    src: string
    alt: string
    caption?: string
  }
}

export interface DividerBlock {
  type: 'divider'
  props?: Record<string, never>
}

export interface CtaBlock {
  type: 'cta'
  props: {
    title: string
    description: string
    buttonText: string
    buttonUrl: string
  }
}

// List item type (used for content list queries)
export interface ContentListItem {
  id: string
  slug: string
  title: string
  subtitle: string | null
  thumbnail_url: string | null
  reading_time_minutes: number
  tags: string[]
  published_at: string
}

// Full content detail type
export interface ContentDetail {
  id: string
  slug: string
  locale: string
  title: string
  subtitle: string | null
  thumbnail_url: string | null
  content_blocks: ContentBlock[]
  reading_time_minutes: number
  tags: string[]
  meta_title: string | null
  meta_description: string | null
  og_image_url: string | null
  canonical_url: string | null
  author_name: string
  is_published: boolean
  published_at: string
  created_at: string
  updated_at: string
}
