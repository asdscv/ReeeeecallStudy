import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { researchContent } from '@reeeeecall/shared/lib/brain-games'

/**
 * `/brain/research` — what the feature borrows from research, and what research does and does not
 * show. Korean and English only for now (see research-content.ts); other languages go back.
 */
export function BrainResearchPage() {
  const { t, i18n } = useTranslation('brain')
  const content = researchContent(i18n.language)
  if (!content) return <Navigate to="/brain" replace />
  return (
    <article className="max-w-2xl mx-auto space-y-6 pb-6" data-testid="brain-research">
      <Link to="/brain" className="inline-flex items-center gap-1 min-h-11 text-sm text-muted-foreground no-underline hover:text-foreground">
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        {t('title')}
      </Link>
      <h1 className="text-2xl font-semibold text-foreground">{content.title}</h1>
      {content.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{section.heading}</h2>
          {section.paragraphs?.map((p, i) => (
            <p key={i} className="text-base text-foreground leading-relaxed">{p}</p>
          ))}
          {section.bullets && (
            <ul className="list-disc pl-5 space-y-2">
              {section.bullets.map((b, i) => (
                <li key={i} className="text-base text-foreground leading-relaxed">{b}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">{content.referencesTitle}</h2>
        <ol className="list-decimal pl-5 space-y-1">
          {content.references.map((r) => (
            <li key={r} className="text-sm text-muted-foreground break-words">{r}</li>
          ))}
        </ol>
      </section>
      <p className="text-sm text-muted-foreground border-t border-border pt-4">{content.disclaimer}</p>
    </article>
  )
}
