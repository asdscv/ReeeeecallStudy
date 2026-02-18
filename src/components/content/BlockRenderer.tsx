import type { ContentBlock } from '../../types/content-blocks'
import { BLOCK_REGISTRY } from './blocks'

interface BlockRendererProps {
  blocks: ContentBlock[]
}

export function BlockRenderer({ blocks }: BlockRendererProps) {
  return (
    <>
      {blocks.map((block, index) => {
        const Component = BLOCK_REGISTRY[block.type]
        if (!Component) return null

        return (
          <Component
            key={`${block.type}-${index}`}
            props={'props' in block ? block.props : {}}
          />
        )
      })}
    </>
  )
}
