import type { HighlightBoxBlock as HighlightBoxBlockType } from '../../../types/content-blocks'

const VARIANT_STYLES: Record<string, string> = {
  blue: 'bg-blue-600 text-white',
  green: 'bg-green-600 text-white',
  amber: 'bg-amber-500 text-white',
}

export function HighlightBoxBlock({ props }: { props: HighlightBoxBlockType['props'] }) {
  const variant = props.variant || 'blue'
  const style = VARIANT_STYLES[variant] || VARIANT_STYLES.blue

  return (
    <div className={`rounded-2xl p-6 sm:p-8 my-8 ${style}`}>
      <h3 className="text-xl sm:text-2xl font-bold mb-2">{props.title}</h3>
      <p className="opacity-90 leading-relaxed">{props.description}</p>
    </div>
  )
}
