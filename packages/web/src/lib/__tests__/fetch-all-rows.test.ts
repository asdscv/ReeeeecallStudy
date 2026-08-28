import { describe, expect, it, vi } from 'vitest'
import { fetchAllRows, fetchRowsByIds } from '@reeeeecall/shared/lib/fetch-all-rows'

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

describe('fetchRowsByIds', () => {
  it('splits the id list into chunks and pages each one', async () => {
    const seen: string[][] = []
    const rows = await fetchRowsByIds<string>(
      ['a', 'b', 'c', 'd', 'e'],
      (chunk) => {
        seen.push(chunk)
        return { range: async () => ({ data: chunk, error: null }) }
      },
      2,
    )
    expect(seen).toEqual([['a', 'b'], ['c', 'd'], ['e']])
    expect(rows).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns nothing for an empty id list without querying', async () => {
    const makeQuery = vi.fn()
    await expect(fetchRowsByIds([], makeQuery)).resolves.toEqual([])
    expect(makeQuery).not.toHaveBeenCalled()
  })

  it('rejects a non-positive chunk size instead of looping forever', async () => {
    await expect(fetchRowsByIds(['a'], () => ({ range: async () => ({ data: [], error: null }) }), 0))
      .rejects.toThrow(RangeError)
  })

  it('propagates a chunk failure rather than returning the chunks before it', async () => {
    await expect(
      fetchRowsByIds<string>(['a', 'b'], (chunk) => ({
        range: async () =>
          chunk[0] === 'b'
            ? { data: null, error: { message: 'chunk two failed' } }
            : { data: chunk, error: null },
      }), 1),
    ).rejects.toThrow(/chunk two failed/)
  })
})
