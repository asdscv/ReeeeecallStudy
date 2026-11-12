import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../logger.js', () => ({ info: vi.fn(), error: vi.fn() }))
import { createSupabaseClient } from '../supabase-client.js'

afterEach(() => vi.unstubAllGlobals())

describe('getOfficialDeckWords', () => {
  it('finds the deck by family tags (Korean levels encoded) and returns its preview cards as rows', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'deck-1' }])))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tags: ['source:ko', 'target:en', 'level:여행'],
        sample_fields: [{ field_values: { kind: 'phrase', front: '이쪽이 맞나요?', back: 'Am I going the right way?', alt: 'Right direction?', situation: '길 물어볼 때' } }],
      })))
    vi.stubGlobal('fetch', fetchMock)
    const db = createSupabaseClient({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc' })

    const rows = await db.getOfficialDeckWords('conversation:여행', 'ko')

    expect(fetchMock.mock.calls[0][0]).toContain(`tags=cs.${encodeURIComponent('{level:여행,source:ko,target:en}')}`)
    expect(fetchMock.mock.calls[1][0]).toBe('https://x.supabase.co/rest/v1/rpc/get_public_listing_preview')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ p_listing_id: 'deck-1' })
    expect(rows).toEqual([{ term: 'Am I going the right way?', meaning: '이쪽이 맞나요?', example: 'Right direction?', exampleNote: '길 물어볼 때' }])
  })

  it('returns nothing for a family with no deck in that language, without a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const db = createSupabaseClient({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc' })
    expect(await db.getOfficialDeckWords('conversation:여행', 'ja')).toEqual([])
    expect(await db.getOfficialDeckWords('jlpt:n2', 'ko')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
