/**
 * 광고 귀속은 "이 가입을 어느 광고가 만들었나" 에 답하기 위한 것이고, 그 답은 며칠 뒤에
 * 필요해진다. 그래서 여기서 지키는 것은 정확히 두 가지다 — 첫 접점이 이기는가, 그리고
 * 광고가 아닌 방문이 첫 접점 자리를 차지해 버리지 않는가.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readAttributionFromUrl, captureAttribution, getStoredAttribution } from '../attribution'

describe('광고 귀속', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('UTM 과 클릭 ID 를 읽는다', () => {
    const a = readAttributionFromUrl(
      '?utm_source=facebook&utm_medium=cpc&utm_campaign=launch&fbclid=ABC123',
      'https://www.facebook.com/',
      '/',
    )
    expect(a).not.toBeNull()
    expect(a!.utm_source).toBe('facebook')
    expect(a!.utm_campaign).toBe('launch')
    expect(a!.fbclid).toBe('ABC123')
    expect(a!.referrer_domain).toBe('www.facebook.com')
    expect(a!.landing_path).toBe('/')
  })

  it('광고 파라미터가 없으면 아무것도 기록하지 않는다', () => {
    // 직접 들어온 방문까지 첫 접점으로 잡아 두면, 나중에 진짜 광고 클릭이 와도
    // write-once 규칙에 막혀 광고가 공을 못 받는다.
    expect(readAttributionFromUrl('', 'https://google.com/', '/')).toBeNull()
    expect(readAttributionFromUrl('?foo=bar', '', '/decks')).toBeNull()
  })

  it('첫 접점이 이긴다 — 두 번째 광고 클릭이 덮어쓰지 않는다', () => {
    const set = (search: string) => {
      Object.defineProperty(window, 'location', {
        value: { search, pathname: '/' },
        writable: true,
      })
      captureAttribution()
    }
    set('?utm_source=facebook&utm_campaign=first')
    set('?utm_source=google&utm_campaign=second')

    const stored = getStoredAttribution()
    expect(stored?.utm_source).toBe('facebook')
    expect(stored?.utm_campaign).toBe('first')
  })

  it('localStorage 가 막혀 있어도 앱을 죽이지 않는다', () => {
    // 사파리 프라이빗 모드에서는 localStorage 접근이 던진다. 계측 때문에 앱이
    // 죽으면 안 되므로 여기서 지키는 계약은 '던지지 않는다' 하나다.
    // (인스턴스에 직접 스파이를 건다 — jsdom 의 localStorage 는 Storage.prototype
    //  을 통해 호출되지 않을 수 있다.)
    const getSpy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => captureAttribution()).not.toThrow()
    expect(() => getStoredAttribution()).not.toThrow()
    getSpy.mockRestore()
    setSpy.mockRestore()
  })

  it('긴 값은 잘라서 저장한다', () => {
    const a = readAttributionFromUrl(`?utm_campaign=${'x'.repeat(500)}`, '', '/')
    expect(a!.utm_campaign!.length).toBe(200)
  })
})
