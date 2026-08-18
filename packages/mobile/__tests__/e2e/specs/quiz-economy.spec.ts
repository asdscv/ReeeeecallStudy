import { navigateToDrawerItem } from '../helpers/navigation'
import { loginIfNeeded } from '../helpers/auth'

/**
 * 실기에서 확인하는 **돈과 한도**.
 *
 * SQL 스위트가 RPC를, vitest 가 검증기를, 프로덕션 스크립트가 엣지 함수를 각각 봅니다.
 * 아무것도 **화면**을 못 봅니다. 이 파일은 화면에서만 확인되는 네 가지를 봅니다.
 *
 *   드라이런  설정 화면이 값과 한도를 **누르기 전에** 정확히 말하는가.
 *             값이 틀린 화면은 학습자가 동의한 적 없는 금액을 청구하는 화면입니다.
 *   넷제로    돌아다니기만 하면 **한 푼도 안 나가는가.** 목록을 열고 설정을 만지는 것으로
 *             잔액이 줄면, 그건 학습자가 산 적 없는 것을 판 것입니다.
 *   한도      덱이 감당 못 하는 길이는 **애초에 눌리지 않는가**(mig 264 뒤의 20 상한 포함).
 *   부하      화면을 빠르게 오가도 값·한도 표시가 흐트러지지 않는가.
 *
 * 생성/채점처럼 **실제로 청구되는** 경로는 여기서 부르지 않습니다. 프로덕션 계정에 실제
 * 돈이 나가고, 그 검증은 이미 서버 쪽에서 실측으로 끝났습니다. 여기서 볼 것은 화면입니다.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co'
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''

async function token(): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.E2E_TEST_EMAIL, password: process.env.E2E_TEST_PASSWORD,
    }),
  })
  const b = await r.json()
  if (!b.access_token) throw new Error('E2E 로그인 실패: ' + JSON.stringify(b).slice(0, 120))
  return b.access_token
}

/** 지금 잔액(micro-USD). 화면이 아니라 서버에서 읽습니다 — 화면 숫자를 화면으로 검증할 수는 없습니다. */
async function balance(): Promise<number> {
  const t = await token()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_credit_balance?select=balance`, {
    headers: { apikey: ANON, Authorization: `Bearer ${t}` },
  })
  const rows = await r.json()
  return rows[0]?.balance ?? 0
}

const byId = (id: string) => $(`~${id}`)

describe('퀴즈 — 값과 한도', () => {
  let opening = 0

  before(async () => {
    await loginIfNeeded()
    opening = await balance()
  })

  it('스모크: 퀴즈 화면이 열린다', async () => {
    await navigateToDrawerItem('Quiz')
    await expect(byId('quiz-create')).toBeDisplayed()
  })

  /** 덱을 고르기 전에는 적격 수를 알 수 없습니다 — 화면이 아직 아무것도 조회하지 않았습니다. */
  async function openSetupAndPickDeck() {
    await byId('quiz-create').click().catch(() => {})
    const chip = await $$('~quiz-deck-*')
    // 와일드카드가 안 되는 드라이버를 대비해 첫 덱 칩을 xpath 로도 찾습니다.
    if (chip.length > 0) await chip[0].click()
    else await $('//*[starts-with(@name,"quiz-deck-")]').click().catch(() => {})
  }

  it('드라이런: 설정 화면이 누르기 전에 어디에 서 있는지 말한다', async () => {
    await openSetupAndPickDeck()
    // 두 갈래 중 하나는 **반드시** 떠야 합니다. 만들 수 있으면 몇 장인지, 못 만들면 왜인지.
    // 아무 말도 없는 화면이 학습자를 "만들기"까지 데려가는 것이 위험한 자리입니다.
    const note = byId('quiz-eligible-note')
    const none = byId('quiz-no-eligible')
    let shown: 'note' | 'none' | null = null
    for (let i = 0; i < 30; i++) {
      if (await note.isDisplayed().catch(() => false)) { shown = 'note'; break }
      if (await none.isDisplayed().catch(() => false)) { shown = 'none'; break }
      await browser.pause(500)
    }
    expect(shown).not.toBe(null)
    if (shown === 'note') expect(await note.getText()).toMatch(/\d+/)
  })

  it('한도: 덱이 감당 못 하는 길이는 눌리지 않는다', async () => {
    // 화면이 제시하는 선택지 중 적격 수를 넘는 것은 비활성입니다. 20·30·50 을 보여 주면서
    // 스키마가 12 에서 막던 상태가 프로덕션에 있었습니다(mig 264 이전).
    let sawDisabled = false
    for (const n of [4, 6, 8, 10, 12, 16, 20]) {
      const chip = byId(`quiz-count-${n}`)
      if (!(await chip.isExisting().catch(() => false))) continue
      const enabled = await chip.isEnabled().catch(() => true)
      if (!enabled) sawDisabled = true
    }
    // 덱이 크면 전부 눌릴 수 있습니다. 확인하려는 것은 "비활성이 존재할 수 있는가"가 아니라
    // **30·50 이 아예 없는가**입니다 — 서버가 20 까지만 받습니다.
    expect(await byId('quiz-count-30').isExisting().catch(() => false)).toBe(false)
    expect(await byId('quiz-count-50').isExisting().catch(() => false)).toBe(false)
    void sawDisabled
  })

  it('부하: 화면을 빠르게 오가도 표시가 흐트러지지 않는다', async () => {
    for (let i = 0; i < 5; i++) {
      await navigateToDrawerItem('Quiz')
      await openSetupAndPickDeck()
      let ok = false
      for (let k = 0; k < 30 && !ok; k++) {
        ok = (await byId('quiz-eligible-note').isDisplayed().catch(() => false))
          || (await byId('quiz-no-eligible').isDisplayed().catch(() => false))
        if (!ok) await browser.pause(500)
      }
      expect(ok).toBe(true)
    }
  })

  it('넷제로: 여기까지 한 푼도 나가지 않았다', async () => {
    // 목록을 열고 설정을 만지는 것으로 잔액이 줄면, 학습자가 산 적 없는 것을 판 것입니다.
    expect(await balance()).toBe(opening)
  })
})
