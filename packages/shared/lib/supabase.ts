import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('Missing Supabase environment variables')
  }
  _supabase = createClient(url, anonKey)
  return _supabase
}

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    throw new Error('Supabase not initialized. Call initSupabase() first.')
  }
  return _supabase
}

// 하위 호환: 기존 코드에서 `supabase`를 직접 import하는 패턴 지원
// 각 플랫폼의 entry point에서 initSupabase()를 먼저 호출해야 함
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase()
    const value = client[prop as keyof SupabaseClient]
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
