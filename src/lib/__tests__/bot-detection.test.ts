import { describe, it, expect } from 'vitest'
import { isBot, isValidViewDuration } from '../bot-detection'

// ── isBot ──

describe('isBot', () => {
  it('detects Googlebot', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
  })

  it('detects Bingbot', () => {
    expect(isBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true)
  })

  it('detects Yandex', () => {
    expect(isBot('Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)')).toBe(true)
  })

  it('detects Baidu', () => {
    expect(isBot('Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)')).toBe(true)
  })

  it('detects DuckDuckBot', () => {
    expect(isBot('DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)')).toBe(true)
  })

  it('detects HeadlessChrome', () => {
    expect(isBot('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/90.0')).toBe(true)
  })

  it('detects PhantomJS', () => {
    expect(isBot('Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML) PhantomJS/2.1.1')).toBe(true)
  })

  it('detects empty UA', () => {
    expect(isBot('')).toBe(true)
  })

  it('detects undefined UA', () => {
    expect(isBot(undefined as unknown as string)).toBe(true)
  })

  it('allows regular Chrome', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false)
  })

  it('allows Safari', () => {
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe(false)
  })

  it('allows Firefox', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isBot('googlebot')).toBe(true)
    expect(isBot('GOOGLEBOT')).toBe(true)
  })

  it('detects common crawlers', () => {
    expect(isBot('Slurp')).toBe(true)
    expect(isBot('ia_archiver')).toBe(true)
    expect(isBot('Sogou web spider')).toBe(true)
  })

  it('detects Lighthouse', () => {
    expect(isBot('Mozilla/5.0 Chrome/90.0 Mobile Safari/537.36 Chrome-Lighthouse')).toBe(true)
  })
})

// ── isValidViewDuration ──

describe('isValidViewDuration', () => {
  it('rejects duration less than 2000ms', () => {
    expect(isValidViewDuration(1999)).toBe(false)
    expect(isValidViewDuration(1000)).toBe(false)
    expect(isValidViewDuration(500)).toBe(false)
  })

  it('accepts duration of exactly 2000ms', () => {
    expect(isValidViewDuration(2000)).toBe(true)
  })

  it('accepts normal durations', () => {
    expect(isValidViewDuration(5000)).toBe(true)
    expect(isValidViewDuration(60000)).toBe(true)
    expect(isValidViewDuration(300000)).toBe(true)
  })

  it('accepts duration at exactly 1 hour', () => {
    expect(isValidViewDuration(3600000)).toBe(true)
  })

  it('rejects duration greater than 1 hour', () => {
    expect(isValidViewDuration(3600001)).toBe(false)
  })

  it('rejects negative values', () => {
    expect(isValidViewDuration(-100)).toBe(false)
  })

  it('rejects zero', () => {
    expect(isValidViewDuration(0)).toBe(false)
  })

  it('rejects NaN', () => {
    expect(isValidViewDuration(NaN)).toBe(false)
  })
})
