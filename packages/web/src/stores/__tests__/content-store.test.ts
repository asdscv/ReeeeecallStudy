import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), i18n: { language: 'en' } }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('../../i18n', () => ({ default: mocks.i18n }))
import { useContentStore } from '../content-store'

function query(result: object) {
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result), single: vi.fn().mockResolvedValue(result),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.i18n.language = 'en'
  useContentStore.setState({ currentArticle: null, detailError: null, detailLoading: false, availableContentLocales: [] })
})

describe('article locale parity with the worker', () => {
  it('serves a Korean-only article on the default URL and advertises only existing languages', async () => {
    const locales = query({ data: [{ locale: 'ko' }], error: null })
    const article = query({ data: { slug: 'ko-only', locale: 'ko' }, error: null })
    mocks.from.mockReturnValueOnce(locales).mockReturnValueOnce(article)
    await useContentStore.getState().fetchContentBySlug('ko-only')
    expect(article.eq).toHaveBeenCalledWith('locale', 'ko')
    expect(useContentStore.getState().currentArticle?.locale).toBe('ko')
    expect(useContentStore.getState().availableContentLocales).toEqual(['ko'])
    expect(useContentStore.getState().detailError).toBeNull()
  })

  it('falls back to English when the requested translation does not exist', async () => {
    mocks.i18n.language = 'ja'
    const locales = query({ data: [{ locale: 'en' }, { locale: 'ko' }], error: null })
    const article = query({ data: { slug: 'translated', locale: 'en' }, error: null })
    mocks.from.mockReturnValueOnce(locales).mockReturnValueOnce(article)
    await useContentStore.getState().fetchContentBySlug('translated')
    expect(article.eq).toHaveBeenCalledWith('locale', 'en')
    expect(useContentStore.getState().availableContentLocales).toEqual(['en', 'ko'])
  })

  it('keeps the latest article when an earlier navigation finishes later', async () => {
    let finishOld!: (result: object) => void
    const old = query({})
    old.order.mockReturnValue(new Promise<object>((resolve) => { finishOld = resolve }))
    mocks.from.mockReturnValueOnce(old)
      .mockReturnValueOnce(query({ data: [{ locale: 'en' }], error: null }))
      .mockReturnValueOnce(query({ data: { slug: 'new', locale: 'en' }, error: null }))
    const pending = useContentStore.getState().fetchContentBySlug('old')
    await useContentStore.getState().fetchContentBySlug('new')
    finishOld({ data: [{ locale: 'ko' }], error: null })
    await pending
    expect(useContentStore.getState().currentArticle?.slug).toBe('new')
    expect(mocks.from).toHaveBeenCalledTimes(3)
  })
})
