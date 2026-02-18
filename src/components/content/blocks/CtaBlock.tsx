import type { CtaBlock as CtaBlockType } from '../../../types/content-blocks'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export function CtaBlock({ props }: { props: CtaBlockType['props'] }) {
  return (
    <div className="bg-gray-900 text-white rounded-2xl p-8 sm:p-12 text-center my-10">
      <h3 className="text-2xl sm:text-3xl font-bold mb-3">{props.title}</h3>
      <p className="text-gray-400 mb-6">{props.description}</p>
      <Link
        to={props.buttonUrl}
        className="inline-flex items-center gap-2 px-8 py-3.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition no-underline"
      >
        {props.buttonText}
        <ArrowRight className="w-5 h-5" />
      </Link>
    </div>
  )
}
