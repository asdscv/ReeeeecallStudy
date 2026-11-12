import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { PublicListingPreview } from '../../types/database'
import {
  wordListHeading, wordListIntro, wordListColumns, wordListCta, wordRows, wordListIndexLink,
} from '@reeeeecall/shared/lib/listing-seo'
import { OfficialBadge } from '../common/OfficialBadge'
import { useTrackEvent } from '../../hooks/useTrackEvent'

type PageLang = Parameters<typeof wordListHeading>[1]

interface OfficialWordListProps {
  listing: PublicListingPreview
  lang: PageLang
  signedIn: boolean
}

/** Official deck as a word list in the deck's own language — the same rows the crawler HTML shows. */
export function OfficialWordList({ listing, lang, signedIn }: OfficialWordListProps) {
  const trackEvent = useTrackEvent()
  const rows = wordRows(listing)
  const [termCol, meaningCol, exampleCol] = wordListColumns(lang, listing.category)
  const target = `/marketplace/${listing.id}`
  const studyHref = signedIn ? target : `/auth/login?redirect=${encodeURIComponent(target)}`
  const index = wordListIndexLink(lang)

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 sm:py-16" lang={lang}>
      <nav className="text-sm mb-4">
        <Link to={index.path} className="text-brand hover:underline" data-testid="word-list-index-link">{index.label}</Link>
      </nav>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3" data-testid="listing-title">
          {wordListHeading(listing, lang)}
        </h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <span>{listing.title}</span>
          {listing.owner_is_official && <OfficialBadge />}
        </div>
        <p className="text-muted-foreground leading-relaxed">{wordListIntro(listing, lang)}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border mb-8">
        <table className="w-full text-sm" data-testid="word-list">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-4 py-2.5 font-semibold text-foreground">{termCol}</th>
              <th className="px-4 py-2.5 font-semibold text-foreground">{meaningCol}</th>
              <th className="px-4 py-2.5 font-semibold text-foreground hidden sm:table-cell">{exampleCol}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={`${r.term}-${i}`} className="align-top">
                <td className="px-4 py-2.5 font-semibold text-foreground" lang="en">{r.term}</td>
                <td className="px-4 py-2.5 text-foreground">
                  {r.meaning}
                  {r.example && (
                    <span className="block sm:hidden mt-1 text-xs text-muted-foreground" lang="en">{r.example}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {r.example && <span className="block" lang="en">{r.example}</span>}
                  {r.exampleNote && <span className="block text-xs mt-0.5">{r.exampleNote}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl bg-foreground text-white p-6 sm:p-8 text-center" data-testid="cta-section">
        <Link
          to={studyHref}
          onClick={() => trackEvent({ category: 'marketplace', action: 'word_list_study_click', label: listing.id })}
          className="inline-flex items-center gap-2 px-6 py-3 bg-brand text-white font-semibold rounded-xl hover:bg-brand-hover transition no-underline"
          data-testid="cta-login"
        >
          {wordListCta(listing, lang)}
          <ArrowRight className="w-5 h-5" />
        </Link>
      </div>
    </main>
  )
}
