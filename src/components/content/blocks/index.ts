import type { ComponentType } from 'react'
import { HeroBlock } from './HeroBlock'
import { ParagraphBlock } from './ParagraphBlock'
import { HeadingBlock } from './HeadingBlock'
import { BlockquoteBlock } from './BlockquoteBlock'
import { StatisticsBlock } from './StatisticsBlock'
import { FeatureCardsBlock } from './FeatureCardsBlock'
import { NumberedListBlock } from './NumberedListBlock'
import { HighlightBoxBlock } from './HighlightBoxBlock'
import { ImageBlock } from './ImageBlock'
import { DividerBlock } from './DividerBlock'
import { CtaBlock } from './CtaBlock'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BLOCK_REGISTRY: Record<string, ComponentType<{ props: any }>> = {
  hero: HeroBlock,
  paragraph: ParagraphBlock,
  heading: HeadingBlock,
  blockquote: BlockquoteBlock,
  statistics: StatisticsBlock,
  feature_cards: FeatureCardsBlock,
  numbered_list: NumberedListBlock,
  highlight_box: HighlightBoxBlock,
  image: ImageBlock,
  divider: DividerBlock,
  cta: CtaBlock,
}
