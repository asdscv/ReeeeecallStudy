import { useEffect, useRef } from 'react'
import { Target, HelpCircle, Cpu } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { aiHubEntries } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { isAiBadgeEligible } from '@reeeeecall/shared/lib/ai/hub/types'
import { AI_HUB_GENERATE } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { AiCreditNotice } from '../../components/ai/AiCreditNotice'
import { aiHubBus } from '@reeeeecall/shared/lib/ai/hub/events'

/**
 * The AI 학습 landing: every registered AI feature, and what the user has left to spend.
 *
 * Nothing here names a feature — the tiles come from the registry, so a fourth entry appears
 * on this page and in the nav submenu from its one `.register()` call. The "AI" badge is asked
 * for per entry rather than stored: the learning plan lives in this menu but runs on the
 * device, and badging it would be a claim we do not make.
 */
// 허브 항목의 아이콘 이름(shared 카탈로그)을 lucide 로 그린다. 모바일은 같은 이름을
// Feather 로 그린다 — 이모지였을 때는 두 플랫폼이 같은 그림을 보장할 수 없었다.
const HUB_ICONS: Record<string, typeof Target> = {
  target: Target,
  'help-circle': HelpCircle,
  cpu: Cpu,
}

function HubIcon({ name }: { name: string }) {
  const Icon = HUB_ICONS[name]
  if (!Icon) return null
  return <Icon className="w-6 h-6 text-brand shrink-0" aria-hidden="true" />
}

export function AIHubPage() {
  const { t } = useTranslation('ai-generate')
  const entries = aiHubEntries()
  // One open per visit. StrictMode runs mount effects twice in dev, and a funnel that counts
  // the same arrival twice locally is a funnel nobody trusts.
  const openEmitted = useRef(false)

  useEffect(() => {
    if (openEmitted.current) return
    openEmitted.current = true
    aiHubBus.emit({ type: 'ai_hub.opened', source: 'nav' })
  }, [])



  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">{t('hub.title')}</h1>
        <p className="text-xs text-content-tertiary mt-0.5">{t('hub.subtitle')}</p>
      </div>

      {/* The same notice every AI screen shows, from one rule. This page used to build the
          line inline and the generate screen built it again with a comment saying "same
          wording" — which is how two copies of a sentence stop being the same sentence. */}
      <AiCreditNotice featureId={AI_HUB_GENERATE} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {entries.map((entry) => (
          <Link
            key={entry.id}
            to={entry.webPath}
            onClick={() => aiHubBus.emit({ type: 'ai_hub.entry_opened', entryId: entry.id, source: 'hub' })}
            className="block p-4 bg-card rounded-xl border border-border no-underline transition hover:border-brand/40 hover:bg-accent/40"
          >
            <div className="flex items-start gap-3">
              <HubIcon name={entry.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-foreground">{t(entry.titleKey)}</h2>
                  {isAiBadgeEligible(entry) && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand/10 text-brand">
                      {t('hub.badge.ai')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t(entry.descKey)}</p>
                <p className="text-xs text-brand mt-3">{t('hub.openAction')}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
