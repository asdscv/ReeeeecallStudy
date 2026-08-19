/**
 * 한도는 서버가 정하고, 클라이언트는 그것을 받아 쓴다.
 *
 * 전에는 `tier-config.ts` 의 숫자가 최종이었습니다. 무료 덱 5, 템플릿 20 — 그런데 서버는
 * 그것들을 아예 막지 않았고, 프로덕션에는 덱 32개를 가진 무료 계정이 있었습니다. 값을
 * 바꾸려면 앱 배포가 필요했고, 서버와 갈라지면 사용자가 산 것보다 적게 썼습니다.
 *
 * 이제 `get_my_entitlements()` 한 번이 전부를 주고, 그 값을 클라이언트 쿼터에 부어 둡니다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('@reeeeecall/shared/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const applied: Array<Record<string, number>> = []
vi.mock('@reeeeecall/shared/lib/tier-config', () => ({
  applyServerQuotas: (q: Record<string, number>) => { applied.push(q) },
}))

const { loadEntitlements } = await import('@reeeeecall/shared/lib/entitlements')

const full = {
  tier: 'plan_5k', is_paid: true, ads_free: true,
  cards_total: 100000, decks_total: 2000, templates_total: 500,
  study_sessions_daily: 5000, free_ai_cards_per_day: 10,
}

beforeEach(() => { rpc.mockReset(); applied.length = 0 })

describe('entitlements', () => {
  it('서버 값을 그대로 읽는다', async () => {
    rpc.mockResolvedValue({ data: full, error: null })
    const e = await loadEntitlements()
    expect(e?.tier).toBe('plan_5k')
    expect(e?.isPaid).toBe(true)
    expect(e?.cardsTotal).toBe(100000)
    expect(e?.decksTotal).toBe(2000)
  })

  it('읽은 값을 클라이언트 쿼터에 붓는다', async () => {
    // 이게 없으면 서버에서 한도를 올려도 앱이 옛 숫자로 막습니다.
    rpc.mockResolvedValue({ data: full, error: null })
    await loadEntitlements()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ decks_total: 2000, templates_total: 500 })
  })

  it('광고 여부를 서버가 답한다 — 광고 기능이 붙기 전에도', async () => {
    // 나중에 광고를 넣을 때 클라이언트가 티어를 다시 해석하지 않도록 미리 창구를 둡니다.
    rpc.mockResolvedValue({ data: { ...full, is_paid: false, ads_free: false }, error: null })
    expect((await loadEntitlements())?.adsFree).toBe(false)
  })

  it('못 읽으면 기본값을 건드리지 않는다', async () => {
    // 서버를 못 읽었다는 이유로 사용자를 더 조이거나 더 풀어 주지 않습니다.
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await loadEntitlements()).toBeNull()
    expect(applied).toHaveLength(0)
  })

  it('일부만 온 응답도 쓰지 않는다', async () => {
    // 한도 하나가 빠진 채로 부으면 그 자원만 조용히 기본값에 남아 갈라집니다.
    rpc.mockResolvedValue({ data: { ...full, decks_total: null }, error: null })
    expect(await loadEntitlements()).toBeNull()
    expect(applied).toHaveLength(0)
  })
})
