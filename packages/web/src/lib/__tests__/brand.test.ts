import { describe, expect, it } from 'vitest'
import { withCurrentBrand } from '@reklue/shared/lib/brand'

describe('previously published brand copy', () => {
  it('updates nested article copy without mutating the stored article', () => {
    const article = {
      meta_title: 'Daily practice | ReeeeecallStudy',
      author_name: 'ReeeeecallStudy',
      content_blocks: [{ type: 'cta', props: {
        title: 'Start with ReeeCall Study',
        description: 'ReeeeecallStudy에서 학습하세요.',
        buttonUrl: 'https://reeeeecallstudy.xyz/auth/login?ref=ReeeeecallStudy',
      } }],
    }
    const result = withCurrentBrand(article)
    expect(result.meta_title).toBe('Daily practice | Reklue')
    expect(result.author_name).toBe('Reklue')
    expect(result.content_blocks[0].props.title).toBe('Start with Reklue')
    expect(result.content_blocks[0].props.description).toBe('Reklue에서 학습하세요.')
    expect(result.content_blocks[0].props.buttonUrl).toBe('https://reklue.com/auth/login?ref=ReeeeecallStudy')
    expect(article.content_blocks[0].props.buttonUrl).toBe('https://reeeeecallstudy.xyz/auth/login?ref=ReeeeecallStudy')
    expect(article.author_name).toBe('ReeeeecallStudy')
    expect(withCurrentBrand(result)).toEqual(result)
  })

  it('preserves unrelated domains, email addresses and installed-app identities', () => {
    const identities = {
      url: 'https://example.com/insight/hello',
      path: 'https://example.com/ReeeeecallStudy/logo.png',
      email: 'ReeeeecallStudy@example.com',
      contact: 'admin@reklue.com',
      package: 'com.reeeeecall.study',
      scheme: 'reeeeecall://auth/callback',
      slug: 'reeeeecall-study',
    }
    expect(withCurrentBrand(identities)).toEqual(identities)
    expect(withCurrentBrand('ReeeeecallStudy: admin@reeeeecallstudy.xyz'))
      .toBe('Reklue: admin@reklue.com')
  })
})
