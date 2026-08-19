import { supabase } from './supabase'
import { applyServerQuotas } from './tier-config'

/**
 * 이 계정이 무엇을 할 수 있는가 — **서버가 정하고, 한 번에 온다.**
 *
 * 전에는 화면마다 구독 상태를 따로 읽고 한도는 `tier-config.ts` 에 적힌 숫자를 썼습니다.
 * 그래서 서버 한도를 올려도 앱은 옛 숫자로 막았고(무료 덱 5 vs 실제 32개 보유), 값을 바꾸려면
 * 배포가 필요했습니다.
 *
 * 이제 `get_my_entitlements()` 한 번이 전부를 돌려줍니다. 광고를 붙일 때도 `adsFree` 를
 * 여기서 읽으면 되고, 그건 스키마 변경 없이 이미 나갑니다.
 */
export interface Entitlements {
  readonly tier: string
  readonly isPaid: boolean
  /** 광고를 보여 주지 않아도 되는가. 광고 기능이 붙기 전에도 서버가 이미 답합니다. */
  readonly adsFree: boolean
  readonly cardsTotal: number
  readonly decksTotal: number
  readonly templatesTotal: number
  readonly studySessionsDaily: number
  readonly freeAiCardsPerDay: number
}

type Row = {
  tier?: string | null
  is_paid?: boolean | null
  ads_free?: boolean | null
  cards_total?: number | string | null
  decks_total?: number | string | null
  templates_total?: number | string | null
  study_sessions_daily?: number | string | null
  free_ai_cards_per_day?: number | string | null
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 한 번 불러 와서 클라이언트 쿼터에 부어 둔다.
 *
 * 실패하면 `null` 입니다 — **기본값을 그대로 씁니다.** 서버를 못 읽었다는 이유로 사용자를
 * 더 조이거나 더 풀어 주지 않습니다. 총량은 어차피 서버가 다시 막습니다.
 */
export async function loadEntitlements(): Promise<Entitlements | null> {
  const { data, error } = await supabase.rpc('get_my_entitlements')
  if (error || !data) return null
  const row = data as Row

  const cards = num(row.cards_total)
  const decks = num(row.decks_total)
  const templates = num(row.templates_total)
  const sessions = num(row.study_sessions_daily)
  if (cards === null || decks === null || templates === null || sessions === null) return null

  applyServerQuotas({
    cards_total: cards,
    decks_total: decks,
    templates_total: templates,
    study_sessions_daily: sessions,
  })

  return {
    tier: row.tier ?? 'free',
    isPaid: row.is_paid === true,
    adsFree: row.ads_free === true,
    cardsTotal: cards,
    decksTotal: decks,
    templatesTotal: templates,
    studySessionsDaily: sessions,
    freeAiCardsPerDay: num(row.free_ai_cards_per_day) ?? 0,
  }
}
