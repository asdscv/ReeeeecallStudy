import { getMobileSupabase } from '../../adapters'
import type { UpdateRequirement, UpdateRequirementSource } from './types'

const DEFAULT_TIMEOUT_MS = 4000

/** Resolve a thenable with a timeout, returning `fallback` if it overruns. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const finish = (v: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => finish(fallback), ms)
    Promise.resolve(promise).then(finish, () => finish(fallback))
  })
}

/** Shape of the `get_app_version_requirement` RPC row (snake_case from PG). */
interface RpcRow {
  min_supported_version?: string | null
  latest_version?: string | null
  store_url?: string | null
  message?: string | null
}

/**
 * Fetches the update requirement from Supabase via the
 * `get_app_version_requirement` SECURITY DEFINER RPC. The RPC is granted to
 * `anon`, so this works before login.
 *
 * Fail-open: any error, timeout, missing row, or missing min version resolves
 * to null, which the gate treats as 'ok'. A backend outage must never lock a
 * user out of the app.
 */
export class SupabaseUpdateRequirementSource implements UpdateRequirementSource {
  constructor(
    private readonly getClient: typeof getMobileSupabase = getMobileSupabase,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async fetch(platform: string): Promise<UpdateRequirement | null> {
    try {
      const client = this.getClient()
      const query = client.rpc('get_app_version_requirement', { p_platform: platform })
      const { data, error } = await withTimeout(
        query as PromiseLike<{ data: unknown; error: unknown }>,
        this.timeoutMs,
        { data: null, error: new Error('timeout') },
      )
      if (error || data == null) return null

      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined
      if (!row || row.min_supported_version == null) return null

      return {
        minSupportedVersion: String(row.min_supported_version),
        latestVersion: row.latest_version != null ? String(row.latest_version) : null,
        storeUrl: row.store_url != null ? String(row.store_url) : null,
        message: row.message != null ? String(row.message) : null,
      }
    } catch {
      return null
    }
  }
}
