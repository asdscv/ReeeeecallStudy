import type { HeroBlock as HeroBlockType } from '../../../types/content-blocks'

export function HeroBlock({ props }: { props: HeroBlockType['props'] }) {
  return (
    <header className="mb-10 sm:mb-14">
      <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 leading-tight mb-4">
        {props.title}
      </h1>
      {props.subtitle && (
        <p className="text-lg sm:text-xl text-gray-500 leading-relaxed mb-6">
          {props.subtitle}
        </p>
      )}
      {props.date && (
        <div className="flex items-center gap-4 text-sm text-gray-400">
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
