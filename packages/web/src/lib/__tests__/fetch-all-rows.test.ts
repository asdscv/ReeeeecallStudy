import { describe, expect, it, vi } from 'vitest'
import { fetchAllRows } from '@reeeeecall/shared/lib/fetch-all-rows'

type Result<T> = { data: T[] | null; error: unknown }

function paged<T>(pages: Result<T>[]) {
  let index = 0
  const ranges: Array<[number, number]> = []
  return {
    ranges,
    makeQuery: () => ({
      range: vi.fn(async (from: number, to: number) => {
        ranges.push([from, to])
        return pages[index++] ?? { data: [], error: null }
      }),
    }),
  }
}

describe('fetchAllRows', () => {
  it('collects all pages in stable ranges', async () => {
    const source = paged([
      { data: [1, 2], error: null },
      { data: [3], error: null },
    ])
    await expect(fetchAllRows(source.makeQuery, 2)).resolves.toEqual([1, 2, 3])
    expect(source.ranges).toEqual([[0, 1], [2, 3]])
  })

  it('treats null data as an empty final page', async () => {
    const source = paged<number>([{ data: null, error: null }])
    await expect(fetchAllRows(source.makeQuery, 2)).resolves.toEqual([])
  })

  it('throws on the first page error', async () => {
    const source = paged<number>([{ data: null, error: new Error('offline') }])
    await expect(fetchAllRows(source.makeQuery, 2)).rejects.toThrow(/offset 0.*offline/)
  })

  it('throws instead of returning partial rows on a later page error', async () => {
    const source = paged([
      { data: [1, 2], error: null },
      { data: null, error: { message: 'page two failed', code: 'PGRST' } },
    ])
    await expect(fetchAllRows(source.makeQuery, 2)).rejects.toThrow(/offset 2.*page two failed/)
  })

  it.each([0, -1, NaN, Infinity])('rejects invalid page size: %s', async (pageSize) => {
    await expect(fetchAllRows(() => ({ range: vi.fn() }), pageSize)).rejects.toThrow(/pageSize/)
  })

  it('does not request rows beyond a non-page-aligned safety limit', async () => {
    const source = paged([
      { data: [1, 2], error: null },
      { data: [3], error: null },
    ])
    await expect(fetchAllRows(source.makeQuery, 2, 3)).rejects.toThrow(/safety limit/)
    expect(source.ranges).toEqual([[0, 1], [2, 2]])
  })

  it('fails closed when the safety limit is exhausted by full pages', async () => {
    const source = paged([
      { data: [1, 2], error: null },
      { data: [3, 4], error: null },
    ])
    await expect(fetchAllRows(source.makeQuery, 2, 4)).rejects.toThrow(/safety limit/)
  })
})
