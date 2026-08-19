/**
 * 카드 총량 한도는 **서버 하나**가 정한다.
 *
 * 클라이언트에도 `tier-config.ts` 에 `cards_total`(무료 3,000)이 적혀 있었고, 카드 생성이
 * 그 숫자로 먼저 막았습니다. 서버의 진짜 한도는 `card_limit_settings`(무료)와 구독 스냅샷
 * (유료)입니다.
 *
 * 268 이 무료를 5,000 으로 올리는 순간 두 숫자가 갈라졌습니다 — 3,001번째 카드가 **서버는
 * 허용하는데 클라이언트가 거절**합니다. 한도를 데이터로 옮겨 배포 없이 바꾸게 만든 이유가
 * 그대로 사라집니다.
 *
 * 서버는 PT402/CARD_LIMIT_REACHED 로 거절하고 store 가 그 메시지를 이미 띄웁니다. 그러니
 * 클라이언트는 세지 않습니다. 분당 생성 속도 제한은 남깁니다 — 총량이 아니라 남용 방지입니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const store = readFileSync(
  join(here, '../../../../shared/stores/card-store.ts'), 'utf8')

describe('카드 총량 한도', () => {
  it('클라이언트가 총량을 세지 않는다', () => {
    expect(store).not.toMatch(/cards_total/)
  })

  it('그래도 분당 생성 속도 제한은 남아 있다', () => {
    // 총량과 남용 방지는 다른 문제입니다. 하나를 지우면서 다른 하나를 잃으면 안 됩니다.
    expect(store).toMatch(/guard\.check\('card_create'\)/)
    expect(store).toMatch(/guard\.check\('bulk_card_create'\)/)
  })

  it('서버의 거절을 알아보고 화면에 띄운다', () => {
    // 클라이언트가 미리 막지 않으므로, 서버 거절을 제대로 읽는 것이 유일한 방어선입니다.
    expect(store).toMatch(/isCardLimitError/)
    expect(store).toMatch(/errors:card\.limitReached/)
  })
})
