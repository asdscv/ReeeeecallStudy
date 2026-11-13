import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ContentNav } from '../components/content/ContentNav'
import { SEOHead } from '../components/content/SEOHead'
import { FooterSection } from '../components/landing/FooterSection'
import { SEO } from '../lib/seo-config'
import type { PublicListingPreview } from '../types/database'
import { wordListHeading, wordRows } from '@reeeeecall/shared/lib/listing-seo'
import {
  VOCAB_HUBS, VOCAB_INDEX_PATH, VOCAB_EN_INDEX, VOCAB_LANGUAGE_INDEX,
  VOCAB_HUB_CHOOSER_HEADING, VOCAB_HUB_COLUMNS, LANGUAGE_NATIVE_NAME,
  findVocabHub, isDeckLanguage, vocabHubPath, vocabLanguageIndexPath, vocabIndexHreflang,
  vocabHubHeading, vocabHubShortTitle, vocabHubDescription, vocabHubIntro,
  groupDecksForIndex, orderDecksByLanguage, vocabHubDeckTags,
  type DeckLang, type VocabHub,
} from '@reeeeecall/shared/lib/vocab-hubs'

// /vocabulary, /vocabulary/<lang>, /vocabulary/<exam-level> — the same pages the crawler HTML serves.

interface IndexDeck {
  id: string
  title: string
  category: string
  card_count: number
  tags: string[]
  owner_is_official: boolean
  native_language: string | null
}

const DECK_COLUMNS = 'id,title,category,card_count,tags,owner_is_official,native_language'

function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: item.url })),
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('marketplace')
  return (
    <div className="min-h-screen bg-card">
      <ContentNav backTo="/landing" backLabel={t('preview.backToHome')} />
      <main className="max-w-3xl mx-auto px-4 py-10 sm:py-16">{children}</main>
      <FooterSection />
    </div>
  )
}

function NotFound() {
  const { t } = useTranslation('marketplace')
  return (
    <Shell>
      <SEOHead title={t('preview.notFound')} description="" noIndex />
      <div className="text-center py-10">
        <p className="text-6xl mb-4">404</p>
        <p className="text-muted-foreground text-lg">{t('preview.notFound')}</p>
      </div>
    </Shell>
  )
}

function Loading() {
  return (
    <Shell>
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-accent rounded w-2/3" />
        <div className="h-4 bg-accent rounded w-full" />
        <div className="h-4 bg-accent rounded w-3/4" />
      </div>
    </Shell>
  )
}

const linkClass = 'text-brand hover:underline'

function EnglishIndex() {
  const canonicalUrl = `${SEO.SITE_URL}${VOCAB_INDEX_PATH}`
  return (
    <Shell>
      <SEOHead
        lang="en"
        title={`${VOCAB_EN_INDEX.heading} | ${SEO.BRAND_NAME}`}
        description={VOCAB_EN_INDEX.description}
        ogType="website"
        canonicalUrl={canonicalUrl}
        hreflangAlternates={vocabIndexHreflang(SEO.SITE_URL)}
        jsonLd={breadcrumbJsonLd([{ name: SEO.BRAND_NAME, url: SEO.SITE_URL }, { name: VOCAB_EN_INDEX.heading, url: canonicalUrl }])}
      />
      <div lang="en">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">{VOCAB_EN_INDEX.heading}</h1>
        <p className="text-muted-foreground leading-relaxed mb-8">{VOCAB_EN_INDEX.intro}</p>
        {(['toeic', 'ielts', 'toefl'] as const).map((category) => (
          <section key={category} className="mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-2">{category.toUpperCase()}</h2>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {VOCAB_HUBS.filter((h) => h.category === category).map((h) => (
                <li key={h.slug}><Link to={vocabHubPath(h)} className={linkClass}>{vocabHubShortTitle(h)}</Link></li>
              ))}
            </ul>
          </section>
        ))}
        <h2 className="text-lg font-semibold text-foreground mt-10 mb-2">{VOCAB_EN_INDEX.languagesHeading}</h2>
        <ul className="flex flex-wrap gap-2">
          {(Object.entries(LANGUAGE_NATIVE_NAME) as [DeckLang, string][]).map(([l, name]) => (
            <li key={l}>
              <Link to={vocabLanguageIndexPath(l)} hrefLang={l} lang={l} className="inline-block px-3 py-1.5 rounded-full border border-border text-sm text-foreground hover:border-brand no-underline">
                {name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  )
}

function LanguageIndex({ lang }: { lang: DeckLang }) {
  const [state, setState] = useState<{ lang: DeckLang; decks: IndexDeck[] | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('marketplace_listings')
      .select(DECK_COLUMNS)
      .eq('is_active', true)
      .eq('owner_is_official', true)
      .eq('native_language', lang)
      .limit(1000)
      .then(({ data, error }) => {
        if (!cancelled) setState({ lang, decks: error ? null : ((data ?? []) as IndexDeck[]) })
      })
    return () => { cancelled = true }
  }, [lang])

  if (!state || state.lang !== lang) return <Loading />
  if (!state.decks || state.decks.length === 0) return <NotFound />

  const copy = VOCAB_LANGUAGE_INDEX[lang]
  const canonicalUrl = `${SEO.SITE_URL}${vocabLanguageIndexPath(lang)}`
  return (
    <Shell>
      <SEOHead
        lang={lang}
        title={`${copy.heading} | ${SEO.BRAND_NAME}`}
        description={copy.description}
        ogType="website"
        canonicalUrl={canonicalUrl}
        hreflangAlternates={vocabIndexHreflang(SEO.SITE_URL)}
        jsonLd={breadcrumbJsonLd([{ name: SEO.BRAND_NAME, url: SEO.SITE_URL }, { name: copy.heading, url: canonicalUrl }])}
      />
      <div lang={lang} data-testid="vocabulary-language-index">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">{copy.heading}</h1>
        <p className="text-muted-foreground leading-relaxed mb-8">{copy.intro}</p>
        {groupDecksForIndex(state.decks).map(({ category, decks }) => (
          <section key={category} className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-2">{copy.categories[category]}</h2>
            <ul className="space-y-1.5">
              {decks.map((d) => (
                <li key={d.id}>
                  <Link to={`/d/${d.id}`} className={linkClass}>{wordListHeading({ ...d, sample_fields: [] }, lang)}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="mt-10 text-sm">
          <Link to={VOCAB_INDEX_PATH} hrefLang="en" lang="en" className={linkClass}>{VOCAB_EN_INDEX.heading}</Link>
        </p>
      </div>
    </Shell>
  )
}

interface HubData {
  slug: string
  decks: { id: string; native_language: string | null; card_count: number }[]
  preview: PublicListingPreview
}

function Hub({ hub }: { hub: VocabHub }) {
  const [state, setState] = useState<{ slug: string; data: HubData | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<HubData | null> => {
      const { data: decks } = await supabase
        .from('marketplace_listings')
        .select('id,native_language,card_count')
        .eq('is_active', true)
        .eq('owner_is_official', true)
        .eq('category', hub.category)
        .contains('tags', vocabHubDeckTags(hub))
        .limit(20)
      const ordered = orderDecksByLanguage(decks ?? [])
      if (ordered.length === 0) return null
      // Every language version shares the same English words — any one gives the word list.
      const { data: preview } = await supabase.rpc('get_public_listing_preview', { p_listing_id: ordered[0].id })
      return preview ? { slug: hub.slug, decks: ordered, preview: preview as unknown as PublicListingPreview } : null
    }
    load().then((data) => { if (!cancelled) setState({ slug: hub.slug, data }) })
    return () => { cancelled = true }
  }, [hub])

  if (!state || state.slug !== hub.slug) return <Loading />
  if (!state.data) return <NotFound />

  const { decks, preview } = state.data
  const rows = wordRows(preview)
  const wordCount = preview.card_count || decks[0].card_count || 0
  const heading = vocabHubHeading(hub, wordCount)
  const canonicalUrl = `${SEO.SITE_URL}${vocabHubPath(hub)}`
  return (
    <Shell>
      <SEOHead
        lang="en"
        title={`${heading} | ${SEO.BRAND_NAME}`}
        description={vocabHubDescription(hub, wordCount, rows.length)}
        ogType="website"
        canonicalUrl={canonicalUrl}
        hreflangAlternates={[
          ...decks.map((d) => ({ lang: d.native_language as string, href: `${SEO.SITE_URL}/d/${d.id}` })),
          { lang: 'en', href: canonicalUrl },
          { lang: 'x-default', href: canonicalUrl },
        ]}
        jsonLd={breadcrumbJsonLd([
          { name: SEO.BRAND_NAME, url: SEO.SITE_URL },
          { name: VOCAB_EN_INDEX.heading, url: `${SEO.SITE_URL}${VOCAB_INDEX_PATH}` },
          { name: vocabHubShortTitle(hub), url: canonicalUrl },
        ])}
        keywords={[heading]}
      />
      <div lang="en" data-testid="vocabulary-hub">
        <nav className="text-sm mb-4">
          <Link to={VOCAB_INDEX_PATH} className={linkClass}>{VOCAB_EN_INDEX.heading}</Link>
        </nav>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">{heading}</h1>
        <p className="text-muted-foreground leading-relaxed mb-6">{vocabHubIntro(wordCount, rows.length)}</p>

        <section className="rounded-2xl border border-border p-5 mb-8" data-testid="hub-language-chooser">
          <h2 className="text-base font-semibold text-foreground mb-3">{VOCAB_HUB_CHOOSER_HEADING}</h2>
          <ul className="flex flex-wrap gap-2">
            {decks.map((d) => (
              <li key={d.id}>
                <Link
                  to={`/d/${d.id}`}
                  hrefLang={d.native_language ?? undefined}
                  lang={d.native_language ?? undefined}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand text-brand-foreground text-sm font-medium hover:bg-brand-hover no-underline"
                >
                  {isDeckLanguage(d.native_language) ? LANGUAGE_NATIVE_NAME[d.native_language] : d.native_language}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm" data-testid="hub-word-list">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-4 py-2.5 font-semibold text-foreground">{VOCAB_HUB_COLUMNS[0]}</th>
                <th className="px-4 py-2.5 font-semibold text-foreground">{VOCAB_HUB_COLUMNS[1]}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={`${r.term}-${i}`} className="align-top">
                  <td className="px-4 py-2.5 font-semibold text-foreground">{r.term}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  )
}

export function VocabularyPage() {
  const { slug } = useParams<{ slug?: string }>()
  if (!slug) return <EnglishIndex />
  if (isDeckLanguage(slug)) return <LanguageIndex lang={slug} />
  const hub = findVocabHub(slug)
  return hub ? <Hub hub={hub} /> : <NotFound />
}
