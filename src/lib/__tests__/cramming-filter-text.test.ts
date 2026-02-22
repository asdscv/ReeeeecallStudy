import { describe, it, expect } from 'vitest'
import koStudy from '../../../public/locales/ko/study.json'
import enStudy from '../../../public/locales/en/study.json'

describe('cramming weak card description', () => {
  it('ko weakDesc contains "높"', () => {
    expect(koStudy.cramming.filter.weakDesc).toContain('높')
  })

  it('en weakDesc contains "Difficult"', () => {
    expect(enStudy.cramming.filter.weakDesc).toContain('Difficult')
  })
})
