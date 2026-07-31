interface PageResult<T> {
  data: T[] | null
  error: unknown
}

interface RangeQuery<T> {
  range: (from: number, to: number) => PromiseLike<PageResult<T>>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

/**
 * Fetch every ordered PostgREST page or fail without returning a partial result.
 * `makeQuery` must create a fresh query builder for every page.
 */
export async function fetchAllRows<T>(
  makeQuery: () => unknown,
  pageSize = 1000,
  maxRows = 500_000,
): Promise<T[]> {
  if (!Number.isFinite(pageSize) || pageSize <= 0 || !Number.isInteger(pageSize)) {
    throw new RangeError('pageSize must be a positive finite integer')
  }
  if (!Number.isFinite(maxRows) || maxRows <= 0 || !Number.isInteger(maxRows)) {
    throw new RangeError('maxRows must be a positive finite integer')
  }

  const out: T[] = []
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const requestSize = Math.min(pageSize, maxRows - offset)
    const builder = makeQuery() as RangeQuery<T>
    const { data, error } = await builder.range(offset, offset + requestSize - 1)
    if (error) {
      throw new Error(`Failed to fetch rows at offset ${offset}: ${errorMessage(error)}`)
    }

    const rows = data ?? []
    out.push(...rows)
    if (rows.length < requestSize) return out
  }

  throw new Error(`Row fetch exceeded the ${maxRows} row safety limit`)
}
