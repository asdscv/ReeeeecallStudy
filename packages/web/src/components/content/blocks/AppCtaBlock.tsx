import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import type { AppCtaBlock as AppCtaBlockType } from '../../../types/content-blocks'
import { playStoreUrlWithReferrer } from '@reeeeecall/shared/lib/app-store-links'
import { StoreBadges } from '../../common/AppDownload'
import { useTrackEvent } from '../../../hooks/useTrackEvent'

const MEDIUM = 'app_cta'

export function AppCtaBlock({ props }: { props: AppCtaBlockType['props'] }) {
  const { t, i18n } = useTranslation('content')
  const trackEvent = useTrackEvent()
  const { position, campaign } = props

  const track = (target: 'ios' | 'android' | 'web') =>
    trackEvent({ category: 'content', action: 'app_cta_click', label: `${position}:${target}` })

  const webParams = new URLSearchParams({
    utm_source: 'blog',
    utm_medium: MEDIUM,
    utm_campaign: campaign.slice(0, 200),
    utm_content: `${position}_${i18n.language}`,
  })

  return (
    <aside className="my-10 rounded-2xl border border-border bg-accent/40 p-6 sm:p-8" data-app-cta={position}>
      <h3 className="text-lg sm:text-xl font-bold text-foreground mb-2">{t(`appCta.${position}.title`)}</h3>
      <p className="text-muted-foreground leading-relaxed mb-5">{t(`appCta.${position}.description`)}</p>
      <div className="flex flex-wrap items-center gap-4">
        <StoreBadges
          playStoreHref={playStoreUrlWithReferrer({ source: 'blog', medium: MEDIUM, campaign, content: position })}
          onClick={track}
        />
        <Link
          to={`/auth/login?${webParams.toString()}`}
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
