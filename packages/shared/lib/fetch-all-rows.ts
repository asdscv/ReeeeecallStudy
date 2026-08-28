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
      // The ORIGINAL error travels as `cause`. PostgREST's `code` is how a caller tells 42501
      // from a network blip — flattening it to a message string turned "you are not allowed"
      // into "something went wrong" for every paginated read.
      throw new Error(`Failed to fetch rows at offset ${offset}: ${errorMessage(error)}`,
        { cause: error })
    }

    const rows = data ?? []
    out.push(...rows)
    if (rows.length < requestSize) return out
  }

  throw new Error(`Row fetch exceeded the ${maxRows} row safety limit`)
}

/**
 * Fetch rows for an explicit id list. `.in()` is bounded twice over — by `max_rows` on the
 * response and by URL length on the request — so the ids are chunked and every chunk paged.
 * `makeQuery` must build a fresh query for the chunk it is handed.
 */
export async function fetchRowsByIds<T>(
  ids: readonly string[],
  makeQuery: (chunk: string[]) => unknown,
  chunkSize = 200,
): Promise<T[]> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkSize must be a positive integer')
  }
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    out.push(...(await fetchAllRows<T>(() => makeQuery(chunk))))
  }
  return out
}
