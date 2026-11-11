import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Layers } from 'lucide-react'
import type { AppCtaBlock as AppCtaBlockType } from '../../../types/content-blocks'
import { playStoreUrlWithReferrer } from '@reeeeecall/shared/lib/app-store-links'
import { StoreBadges } from '../../common/AppDownload'
import { useTrackEvent } from '../../../hooks/useTrackEvent'
import { useOfficialDeck } from '../../../hooks/useOfficialDeck'

const MEDIUM = 'app_cta'

export function AppCtaBlock({ props }: { props: AppCtaBlockType['props'] }) {
  const { t, i18n } = useTranslation('content')
  const trackEvent = useTrackEvent()
  const { position, campaign, deckFamily } = props
  const deck = useOfficialDeck(deckFamily, i18n.language)

  const track = (target: 'ios' | 'android' | 'web' | 'deck') =>
    trackEvent({ category: 'content', action: 'app_cta_click', label: `${position}:${target}` })

  const utm = (content: string) => new URLSearchParams({
    utm_source: 'blog',
    utm_medium: MEDIUM,
    utm_campaign: campaign.slice(0, 200),
    utm_content: `${content}_${i18n.language}`,
  }).toString()

  return (
    <aside className="my-10 rounded-2xl border border-border bg-accent/40 p-6 sm:p-8" data-app-cta={position}>
      <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2">{t(`appCta.${position}.title`)}</h3>
      <p className="text-muted-foreground leading-relaxed mb-5">{t(`appCta.${position}.description`)}</p>
      {deck && (
        <Link
          to={`/d/${deck.id}?${utm(`deck_${position}`)}`}
          onClick={() => track('deck')}
          className="group mb-5 flex items-center gap-4 rounded-xl border border-brand/30 bg-card p-4 no-underline transition hover:border-brand"
          data-app-cta-deck={deck.id}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Layers className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-foreground">{deck.title}</span>
            <span className="block text-sm text-muted-foreground">{t('appCta.deck.meta', { count: deck.card_count })}</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-brand whitespace-nowrap">
            {t('appCta.deck.button')}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <StoreBadges
          playStoreHref={playStoreUrlWithReferrer({ source: 'blog', medium: MEDIUM, campaign, content: position })}
          onClick={track}
        />
        <Link
          to={`/auth/login?${utm(position)}`}
          onClick={() => track('web')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-hover no-underline"
        >
          {t('appCta.web')}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </aside>
  )
}
