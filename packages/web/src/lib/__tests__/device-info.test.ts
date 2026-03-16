import { describe, it, expect } from 'vitest'
import { getDeviceType, getViewportCategory } from '../device-info'

describe('getDeviceType', () => {
  it('detects iPhone as mobile', () => {
    expect(getDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('mobile')
  })

  it('detects Android phone as mobile', () => {
    expect(getDeviceType('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile')).toBe('mobile')
  })

  it('detects iPad as tablet', () => {
    expect(getDeviceType('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('tablet')
  })

  it('detects Android tablet as tablet', () => {
    expect(getDeviceType('Mozilla/5.0 (Linux; Android 14; SM-X800) AppleWebKit/537.36')).toBe('tablet')
  })

  it('detects Chrome desktop as desktop', () => {
    expect(getDeviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0')).toBe('desktop')
  })

  it('detects Mac Safari as desktop', () => {
    expect(getDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15')).toBe('desktop')
  })

  it('returns desktop for empty UA', () => {
    expect(getDeviceType('')).toBe('desktop')
  })
})

describe('getViewportCategory', () => {
  it('categorizes narrow viewport as mobile', () => {
    expect(getViewportCategory(375)).toBe('mobile')
  })

  it('categorizes medium viewport as tablet', () => {
    expect(getViewportCategory(768)).toBe('tablet')
  })

  it('categorizes wide viewport as desktop', () => {
    expect(getViewportCategory(1440)).toBe('desktop')
  })

  it('handles boundary at 768px', () => {
    expect(getViewportCategory(767)).toBe('mobile')
    expect(getViewportCategory(768)).toBe('tablet')
  })

  it('handles boundary at 1024px', () => {
    expect(getViewportCategory(1023)).toBe('tablet')
    expect(getViewportCategory(1024)).toBe('desktop')
  })
})
