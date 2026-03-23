import type { HeroBlock as HeroBlockType } from '../../../types/content-blocks'
import { stripMarkdownText } from '../../../lib/content-blocks'

export function HeroBlock({ props }: { props: HeroBlockType['props'] }) {
  return (
    <header className="mb-10 sm:mb-14">
      <h1 className="text-4xl sm:text-5xl font-extrabold text-foreground leading-tight mb-4">
        {stripMarkdownText(props.title)}
      </h1>
      {props.subtitle && (
        <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed mb-6">
          {stripMarkdownText(props.subtitle)}
        </p>
      )}
      {props.date && (
        <div className="flex items-center gap-4 text-sm text-content-tertiary">
          <time dateTime={props.date}>
            {new Date(props.date).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
        </div>
      )}
    </header>
  )
}
