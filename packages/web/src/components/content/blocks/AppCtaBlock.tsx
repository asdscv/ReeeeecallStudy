import { brainGuide, brainGuidePath, brainGuideLoginPath, brainCtaCopy } from '@reeeeecall/shared/lib/brain-content'
import { useAuthStore } from '../../../stores/auth-store'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Layers, Brain } from 'lucide-react'
import type { AppCtaBlock as AppCtaBlockType } from '../../../types/content-blocks'
import { playStoreUrlWithReferrer } from '@reeeeecall/shared/lib/app-store-links'
import { StoreBadges } from '../../common/AppDownload'
import { useTrackEvent } from '../../../hooks/useTrackEvent'
import { useOfficialDeck } from '../../../hooks/useOfficialDeck'
import { isDeckLanguage, vocabHubForFamily, vocabHubPath, vocabHubShortTitle } from '@reeeeecall/shared/lib/vocab-hubs'

const MEDIUM = 'app_cta'

export function AppCtaBlock({ props }: { props: AppCtaBlockType['props'] }) {
  const { t, i18n } = useTranslation('content')
  const trackEvent = useTrackEvent()
  const { position, campaign, deckFamily } = props
  const brain = brainGuide(props.brainGuide)
  const copy = brainCtaCopy(props.locale || i18n.language)
  const user = useAuthStore((s) => s.user)
  const brainHref = brain && (user ? brainGuidePath(brain.id) : brainGuideLoginPath(brain.id))
  const deck = useOfficialDeck(brain ? undefined : deckFamily, i18n.language)
  // No deck carries English meanings — English readers get the English word list for the exam level.
  const hub = isDeckLanguage(i18n.language.slice(0, 2)) ? null : vocabHubForFamily(deckFamily)

  const track = (target: 'ios' | 'android' | 'web' | 'deck' | 'hub' | 'brain') =>
    trackEvent({ category: 'content', action: 'app_cta_click', label: `${position}:${target}` })

  const utm = (content: string) => new URLSearchParams({
    utm_source: 'blog',
    utm_medium: MEDIUM,
    utm_campaign: campaign.slice(0, 200),
    utm_content: `${content}_${i18n.language}`,
  }).toString()

  return (
    <aside className="my-10 rounded-2xl border border-border bg-accent/40 p-6 sm:p-8" data-app-cta={position}>
      <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2">{brain ? copy.title : t(`appCta.${position}.title`)}</h3>
      <p className="text-muted-foreground leading-relaxed mb-5">{brain ? copy.description : t(`appCta.${position}.description`)}</p>
      {brainHref && (
        <Link to={`${brainHref}${brainHref.includes('?') ? '&' : '?'}${utm(`brain_${position}`)}`} onClick={() => track('brain')}
          className="mb-5 inline-flex min-h-14 items-center gap-3 rounded-xl bg-brand px-5 py-3 font-semibold text-white no-underline hover:bg-brand-hover" data-app-cta-brain={brain?.id}>
          <Brain className="h-5 w-5" aria-hidden="true" />{copy.button}<ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
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
      {!brain && !deck && hub && (
        <Link
          to={`${vocabHubPath(hub)}?${utm(`hub_${position}`)}`}
          onClick={() => track('hub')}
          className="group mb-5 flex items-center gap-4 rounded-xl border border-brand/30 bg-card p-4 no-underline transition hover:border-brand"
          data-app-cta-hub={hub.slug}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Layers className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-foreground">{vocabHubShortTitle(hub)}</span>
            <span className="block text-sm text-muted-foreground">{t('appCta.hub.meta')}</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-brand whitespace-nowrap">
            {t('appCta.hub.button')}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <StoreBadges
          playStoreHref={playStoreUrlWithReferrer({ source: 'blog', medium: MEDIUM, campaign, content: position })}
          onClick={track}
        />
        {!brain && <Link
          to={`/auth/login?${utm(position)}`}
          onClick={() => track('web')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-hover no-underline"
        >
          {t('appCta.web')}
          <ArrowRight className="w-4 h-4" />
        </Link>}
      </div>
    </aside>
  )
}
