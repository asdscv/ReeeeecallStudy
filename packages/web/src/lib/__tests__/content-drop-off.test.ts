import { describe, it, expect } from 'vitest'
import { withDropOffCtas } from '@reeeeecall/shared/lib/content-drop-off'
import { playStoreUrlWithReferrer, PLAY_STORE_URL } from '@reeeeecall/shared/lib/app-store-links'

const b = (type: string) => ({ type })
const types = (blocks: Array<{ type: string }>) => blocks.map((x) => x.type)

// The shape the daily pipeline writes: hero, intro, question H2 + answer, body sections, closing CTA.
const ARTICLE = [
  b('hero'), b('paragraph'),
  b('heading'), b('paragraph'), b('numbered_list'),
  b('heading'), b('paragraph'), b('highlight_box'),
  b('heading'), b('paragraph'),
  b('cta'),
]

describe('withDropOffCtas', () => {
  it('meets the reader right after the first answer and again before the wrap-up', () => {
    expect(types(withDropOffCtas(ARTICLE, 'slug'))).toEqual([
      'hero', 'paragraph',
      'heading', 'paragraph', 'app_cta', 'numbered_list',
      'heading', 'paragraph', 'highlight_box',
      'app_cta', 'heading', 'paragraph',
      'cta',
    ])
  })

  it('tags each CTA with its position and the article it came from', () => {
    const ctas = withDropOffCtas(ARTICLE, 'toeic-part-5').filter((x) => x.type === 'app_cta')
    expect(ctas.map((x) => ('props' in x ? x.props : null))).toEqual([
      { position: 'answer', campaign: 'toeic-part-5' },
      { position: 'wrap_up', campaign: 'toeic-part-5' },
    ])
  })

  it('keeps the closing CTA last and never stacks two CTAs', () => {
    const out = types(withDropOffCtas(ARTICLE, 's'))
    expect(out.at(-1)).toBe('cta')
    out.forEach((t, i) => {
      if (i > 0 && (t === 'app_cta' || t === 'cta')) expect(['app_cta', 'cta']).not.toContain(out[i - 1])
    })
  })

  it('skips the wrap-up CTA when the article has one section', () => {
    const one = [b('hero'), b('paragraph'), b('heading'), b('paragraph'), b('feature_cards'), b('paragraph'), b('cta')]
    expect(types(withDropOffCtas(one, 's')).filter((t) => t === 'app_cta')).toHaveLength(1)
  })

  it('falls back to the first paragraph after the hero when there are no headings', () => {
    const flat = [b('hero'), b('paragraph'), b('paragraph'), b('feature_cards'), b('paragraph'), b('paragraph'), b('cta')]
    expect(types(withDropOffCtas(flat, 's')).slice(0, 3)).toEqual(['hero', 'paragraph', 'app_cta'])
  })

  it('leaves short articles alone', () => {
    const short = [b('hero'), b('paragraph'), b('heading'), b('paragraph'), b('cta')]
    expect(types(withDropOffCtas(short, 's'))).toEqual(types(short))
  })
})

describe('playStoreUrlWithReferrer', () => {
  it('carries the attribution in one encoded referrer parameter', () => {
    const url = playStoreUrlWithReferrer({ source: 'blog', medium: 'app_cta', campaign: 'toeic-part-5', content: 'answer' })
    expect(url.startsWith(`${PLAY_STORE_URL}&referrer=`)).toBe(true)
    const referrer = new URL(url).searchParams.get('referrer')
    expect(Object.fromEntries(new URLSearchParams(referrer ?? ''))).toEqual({
      utm_source: 'blog', utm_medium: 'app_cta', utm_campaign: 'toeic-part-5', utm_content: 'answer',
    })
  })
})
