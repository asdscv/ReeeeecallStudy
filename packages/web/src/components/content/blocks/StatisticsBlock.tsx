import type { StatisticsBlock as StatisticsBlockType } from '../../../types/content-blocks'
import { stripMarkdownText } from '../../../lib/content-blocks'

export function StatisticsBlock({ props }: { props: StatisticsBlockType['props'] }) {
  return (
    <div className="bg-muted rounded-2xl p-6 sm:p-8 my-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        {props.items.map((item, i) => (
          <div key={i} className="text-center h-full flex flex-col items-center justify-center">
            <div className="text-3xl font-bold text-brand mb-1">{stripMarkdownText(item.value)}</div>
            <div className="text-sm text-muted-foreground">{stripMarkdownText(item.label)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
