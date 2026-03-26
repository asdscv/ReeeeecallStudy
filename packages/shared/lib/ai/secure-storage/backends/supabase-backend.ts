import { getSupabase } from '../../../supabase'
import type { IAsyncKeyBackend } from '../types'
import type { ProviderKeyEntry, ProviderKeyMap } from '../ai-key-vault'

/**
 * SECURITY: Supabase 서버사이드 암호화 키 저장소.
 *
 * 보안 아키텍처:
 *   - API 키는 pgcrypto pgp_sym_encrypt로 서버에서 암호화
 *   - 암호화 패스프레이즈는 Supabase Vault에 저장 → 클라이언트 접근 불가
 *   - 모든 연산은 SECURITY DEFINER RPC → auth.uid() 검증
 *   - RLS로 방어 다중화 (defense-in-depth)
 *   - 복호화된 키는 TLS(HTTPS)로만 전송
 *
 * 위협 모델:
 *   - DB 탈취: BYTEA 암호문만 획득, Vault 시크릿 없이 복호화 불가
 *   - 클라이언트 탈취: 인증된 유저 키만 RPC로 접근 가능
 *   - 네트워크: TLS 보호
 *   - XSS: localStorage 미사용 → XSS로 키 탈취 불가
 *
 * vs 이전 방식 (localStorage + AES-GCM):
 *   - UID 기반 키 파생 → UID는 비밀이 아님 (JWT에 노출)
 *   - XSS 시 localStorage + UID 모두 탈취 가능
 *   - 디바이스 간 동기화 불가
 */
export class SupabaseKeyBackend implements IAsyncKeyBackend {
  async loadAll(_uid: string): Promise<ProviderKeyMap> {
    const { data, error } = await getSupabase().rpc('get_ai_provider_keys')
    if (error) throw error

    const map: ProviderKeyMap = {}
    for (const row of (data ?? []) as Array<{
      provider_id: string
      api_key: string
      model: string
      base_url: string | null
      saved_at: string
    }>) {
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
    const { error } = await getSupabase().rpc('upsert_ai_provider_key', {
      p_provider_id: providerId,
      p_api_key: entry.apiKey,
      p_model: entry.model,
      p_base_url: entry.baseUrl ?? null,
    })
    if (error) throw error
  }

  async removeProvider(_uid: string, providerId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_ai_provider_key', {
      p_provider_id: providerId,
    })
    if (error) throw error
  }
}
