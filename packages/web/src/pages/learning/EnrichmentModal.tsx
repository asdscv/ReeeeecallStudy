import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { useLearningStore, type EnrichmentPreview } from '../../stores/learning-store'

/**
 * The result of a paid remediation, shown for keep-or-discard.
 *
 * Two things this deliberately does NOT do:
 *   * imply that rejecting refunds anything. The generation is already charged
 *     (`ai-generate` reserves before the model call and charges the real token cost after),
 *     so this decision is only about keeping the content.
 *   * render "sources: none" as acceptable for grounded content. When the server requires
 *     grounding it refuses instead of returning an ungrounded answer, so an empty source
 *     list here means the answer was not source-based — and the copy says so rather than
 *     leaving a blank space where citations should be.
 */

/** Render whatever shape the model returned without inventing structure it does not have. */
function ContentBlocks({ content }: { content: Record<string, unknown> }) {
  const { t } = useTranslation('learning')
  const entries = Object.entries(content).filter(([key]) => key !== 'sources')

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('enrichment.empty')}</p>
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key}>
          <p className="text-[11px] uppercase tracking-wide text-content-tertiary">{key}</p>
          {Array.isArray(value) ? (
            <ul className="mt-1 list-disc pl-5 space-y-1">
              {value.map((entry, i) => (
                <li key={i} className="text-sm text-foreground">
                  {typeof entry === 'object' && entry !== null
                    ? Object.values(entry as Record<string, unknown>).filter((v) => typeof v === 'string').join(' — ')
                    : String(entry)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
              {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

export function EnrichmentModal({ preview }: { preview: EnrichmentPreview }) {
  const { t } = useTranslation('learning')
  const { enrichmentSaving, resolveEnrichment, dismissEnrichment } = useLearningStore()

  return (
    /* Backdrop and Escape map to `dismissEnrichment` — "later", the preview stays pending —
       and never to `resolveEnrichment('rejected')`. The generation is ALREADY charged, so
       wiring an outside click to the discard action would silently burn credits the learner
       paid for on a gesture they did not mean as a decision. */
    <Dialog open onOpenChange={(next) => { if (!next) dismissEnrichment() }}>
      <DialogContent className="sm:max-w-lg" aria-label={t(`enrichment.action.${preview.action}`)}>
        <DialogHeader>
          <DialogTitle className="text-base font-medium">
            {t(`enrichment.action.${preview.action}`)}
          </DialogTitle>
        </DialogHeader>

      <div className="space-y-3">
        <ContentBlocks content={preview.content} />

        <div className="pt-1 border-t border-border">
          <p className="text-[11px] uppercase tracking-wide text-content-tertiary">
            {t('enrichment.sources')}
          </p>
          {preview.sources.length === 0 ? (
            <p className="mt-1 text-xs text-content-tertiary">{t('enrichment.noSources')}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {preview.sources.map((source, i) => (
                <li key={i} className="text-xs text-foreground">
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                      {source.title || source.url}
                    </a>
                  ) : (
                    <span>{source.title || source.clause || source.id}</span>
                  )}
                  {source.clause && source.title && (
                    <span className="text-content-tertiary"> · {source.clause}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* The charge already happened. Saying so here is the difference between an honest
            "keep this?" and an implied "cancel for a refund". */}
        <p className="text-[11px] text-content-tertiary">{t('enrichment.chargedNote')}</p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={dismissEnrichment}
            className="mr-auto text-xs text-content-tertiary hover:underline cursor-pointer"
          >
            {t('enrichment.later')}
          </button>
          <button
            type="button"
            disabled={enrichmentSaving}
            onClick={() => void resolveEnrichment('rejected')}
            className="px-3 py-1.5 text-sm border border-border rounded-lg cursor-pointer hover:bg-accent disabled:opacity-50"
          >
            {t('enrichment.discard')}
          </button>
          <button
            type="button"
            disabled={enrichmentSaving}
            onClick={() => void resolveEnrichment('accepted')}
            className="px-4 py-1.5 text-sm font-medium bg-brand text-white rounded-lg cursor-pointer transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {enrichmentSaving ? t('enrichment.saving') : t('enrichment.keep')}
          </button>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  )
}
