import { getSupabase } from '../../../supabase'
import type { IAsyncKeyBackend } from '../types'
import type { ProviderKeyEntry, ProviderKeyMap } from '../ai-key-vault'

/**
 * SECURITY: AI provider 키 저장소 — `ai-keys` Edge Function 경유 (H1).
 *
 * 보안 아키텍처:
 *   - API 키는 pgcrypto pgp_sym_encrypt로 서버(DB)에서 암호화
 *   - 암호화 패스프레이즈는 Supabase Edge Secret(AI_KEY_PASSPHRASE)에만 존재
 *     → DB 테이블(_ai_encryption_config) 평문 보관 폐지, DB 덤프만으로 복호화 불가
 *   - Edge Function이 유저 JWT 검증 → service-role로 *_secure DB 함수 호출
 *     (get/upsert/delete_ai_provider_key_secure, service_role 전용)
 *   - 복호화된 키는 TLS(HTTPS)로만 전송
 *
 * 위협 모델:
 *   - DB 탈취: BYTEA 암호문만 획득, Edge Secret 없이 복호화 불가
 *   - 클라이언트 탈취: 인증된 유저 키만 Edge(JWT 검증) 경유로 접근 가능
 *   - 네트워크: TLS 보호
 *   - XSS: localStorage 미사용 → XSS로 키 탈취 불가
 */

interface KeyRow {
  provider_id: string
  api_key: string
  model: string
  base_url: string | null
  saved_at: string
}

async function invokeAiKeys<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('ai-keys', { body })
  if (error) throw error
  return data as T
}

export class SupabaseKeyBackend implements IAsyncKeyBackend {
  async loadAll(_uid: string): Promise<ProviderKeyMap> {
    const data = await invokeAiKeys<{ keys: KeyRow[] }>({ action: 'list' })

    const map: ProviderKeyMap = {}
    for (const row of data?.keys ?? []) {
      map[row.provider_id] = {
        apiKey: row.api_key,
        model: row.model,
        baseUrl: row.base_url ?? undefined,
        savedAt: row.saved_at,
      }
    }
    return map
  }

  async saveProvider(_uid: string, providerId: string, entry: ProviderKeyEntry): Promise<void> {
    await invokeAiKeys<{ ok: true }>({
      action: 'upsert',
      providerId,
      apiKey: entry.apiKey,
      model: entry.model,
      baseUrl: entry.baseUrl ?? null,
    })
  }

  async removeProvider(_uid: string, providerId: string): Promise<void> {
    await invokeAiKeys<{ ok: true }>({ action: 'delete', providerId })
  }
}
