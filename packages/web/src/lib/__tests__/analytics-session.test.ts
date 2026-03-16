import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getAnalyticsSessionId } from '../analytics-session'

describe('getAnalyticsSessionId', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a UUID string', () => {
    const id = getAnalyticsSessionId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('returns the same ID on subsequent calls within same session', () => {
    const id1 = getAnalyticsSessionId()
    const id2 = getAnalyticsSessionId()
    expect(id1).toBe(id2)
  })

  it('stores the ID under "analytics_session" key', () => {
    const id = getAnalyticsSessionId()
    expect(sessionStorage.getItem('analytics_session')).toBe(id)
  })

  it('returns existing ID from sessionStorage if present', () => {
    const existingId = 'test-session-id-123'
    sessionStorage.setItem('analytics_session', existingId)
    expect(getAnalyticsSessionId()).toBe(existingId)
  })

  it('returns a valid UUID when sessionStorage throws', () => {
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled')
    })

    const id = getAnalyticsSessionId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('does not persist to sessionStorage when storage throws', () => {
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled')
    })
    const setItemSpy = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage disabled')
    })

    getAnalyticsSessionId()
    // setItem is never reached because getItem throws first
    expect(setItemSpy).not.toHaveBeenCalled()
  })
})
