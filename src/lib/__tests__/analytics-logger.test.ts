import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logAnalyticsError } from '../analytics-logger'

describe('logAnalyticsError', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls console.warn in dev mode with context and error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const error = new Error('RPC failed')
    logAnalyticsError('record_content_view', error)

    expect(warnSpy).toHaveBeenCalledWith('[Analytics]', 'record_content_view', error)
  })

  it('handles string errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logAnalyticsError('record_page_view', 'network error')

    expect(warnSpy).toHaveBeenCalledWith('[Analytics]', 'record_page_view', 'network error')
  })

  it('handles null/undefined errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logAnalyticsError('test', null)
    logAnalyticsError('test', undefined)

    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})
