import { describe, it, expect } from 'vitest'
import { normalizePagePath, shouldTrackPage } from '../page-tracking'

describe('normalizePagePath', () => {
  it('removes trailing slash', () => {
    expect(normalizePagePath('/insight/')).toBe('/insight')
  })

  it('removes query parameters', () => {
    expect(normalizePagePath('/insight?utm_source=google')).toBe('/insight')
  })

  it('removes hash fragment', () => {
    expect(normalizePagePath('/insight#section')).toBe('/insight')
  })

  it('keeps root path as /', () => {
    expect(normalizePagePath('/')).toBe('/')
  })

  it('normalizes double slashes', () => {
    expect(normalizePagePath('/insight//detail')).toBe('/insight/detail')
  })

  it('handles complex paths', () => {
    expect(normalizePagePath('/insight/my-article/?ref=home#top')).toBe('/insight/my-article')
  })

  it('handles empty string', () => {
    expect(normalizePagePath('')).toBe('/')
  })
})

describe('shouldTrackPage', () => {
  it('tracks dashboard', () => {
    expect(shouldTrackPage('/dashboard')).toBe(true)
  })

  it('tracks content pages', () => {
    expect(shouldTrackPage('/insight')).toBe(true)
    expect(shouldTrackPage('/insight/my-article')).toBe(true)
  })

  it('tracks landing page', () => {
    expect(shouldTrackPage('/landing')).toBe(true)
  })

  it('does not track admin pages', () => {
    expect(shouldTrackPage('/admin')).toBe(false)
    expect(shouldTrackPage('/admin/users')).toBe(false)
    expect(shouldTrackPage('/admin/contents')).toBe(false)
  })

  it('does not track auth callback', () => {
    expect(shouldTrackPage('/auth/callback')).toBe(false)
  })

  it('does not track auth login', () => {
    expect(shouldTrackPage('/auth/login')).toBe(false)
  })

  it('tracks marketplace', () => {
    expect(shouldTrackPage('/marketplace')).toBe(true)
  })

  it('tracks root', () => {
    expect(shouldTrackPage('/')).toBe(true)
  })

  it('does not track auth reset-password', () => {
    expect(shouldTrackPage('/auth/reset-password')).toBe(false)
  })

  it('tracks decks pages', () => {
    expect(shouldTrackPage('/decks')).toBe(true)
    expect(shouldTrackPage('/decks/abc-123')).toBe(true)
  })

  it('tracks guide page', () => {
    expect(shouldTrackPage('/guide')).toBe(true)
  })

  it('tracks docs/api page', () => {
    expect(shouldTrackPage('/docs/api')).toBe(true)
  })

  it('handles trailing slash in excluded paths', () => {
    expect(shouldTrackPage('/admin/')).toBe(false)
    expect(shouldTrackPage('/auth/login/')).toBe(false)
  })

  it('tracks paths that start with excluded prefix but are different segments', () => {
    expect(shouldTrackPage('/administrator')).toBe(true)
    expect(shouldTrackPage('/admin-panel')).toBe(true)
    expect(shouldTrackPage('/authentication')).toBe(true)
    expect(shouldTrackPage('/authorize')).toBe(true)
  })
})
