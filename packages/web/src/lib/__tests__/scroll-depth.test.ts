import { describe, it, expect } from 'vitest'
import { computeScrollMilestone, SCROLL_MILESTONES } from '../scroll-depth'

describe('SCROLL_MILESTONES', () => {
  it('contains standard milestones', () => {
    expect(SCROLL_MILESTONES).toEqual([0, 25, 50, 75, 100])
  })
})

describe('computeScrollMilestone', () => {
  it('returns 0 for zero scroll', () => {
    expect(computeScrollMilestone(0, 2000, 800)).toBe(0)
  })

  it('returns 25 for ~25% scroll', () => {
    // documentHeight=2000, viewportHeight=800, scrollable=1200
    // scrollTop=300 → 300/1200=25%
    expect(computeScrollMilestone(300, 2000, 800)).toBe(25)
  })

  it('returns 50 for ~50% scroll', () => {
    expect(computeScrollMilestone(600, 2000, 800)).toBe(50)
  })

  it('returns 75 for ~75% scroll', () => {
    expect(computeScrollMilestone(900, 2000, 800)).toBe(75)
  })

  it('returns 100 at bottom of page', () => {
    expect(computeScrollMilestone(1200, 2000, 800)).toBe(100)
  })

  it('handles 0 document height', () => {
    expect(computeScrollMilestone(100, 0, 800)).toBe(0)
  })

  it('handles document height equal to viewport (no scroll needed)', () => {
    expect(computeScrollMilestone(0, 800, 800)).toBe(100)
  })

  it('handles document height smaller than viewport', () => {
    expect(computeScrollMilestone(0, 400, 800)).toBe(100)
  })

  it('clamps over-scroll to 100', () => {
    expect(computeScrollMilestone(2000, 2000, 800)).toBe(100)
  })

  it('returns nearest lower milestone for in-between values', () => {
    // scrollTop=200/1200=16.7% → nearest lower milestone = 0
    expect(computeScrollMilestone(200, 2000, 800)).toBe(0)
    // scrollTop=400/1200=33.3% → nearest lower milestone = 25
    expect(computeScrollMilestone(400, 2000, 800)).toBe(25)
  })
})
