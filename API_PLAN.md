# API Plan — Reeecall Study REST API

## Architecture

Supabase Edge Function (Deno + Hono) + `api_keys` 테이블 기반 인증

```
Client → Authorization: Bearer rc_xxxxx
           ↓
  Supabase Edge Function (Hono)
           ↓
  api_keys 테이블에서 key_hash 조회 → user_id 식별
           ↓
  Supabase Service Role로 데이터 조회/등록
           ↓
  JSON Response
```

## Endpoints (v1)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/v1/me` | 내 프로필 |
| GET | `/v1/decks` | 덱 목록 |
| GET | `/v1/decks/:deckId` | 덱 상세 (카드 수 포함) |
| GET | `/v1/decks/:deckId/cards` | 덱의 카드 목록 (페이지네이션) |
| GET | `/v1/cards/:cardId` | 카드 상세 |
| POST | `/v1/decks/:deckId/cards` | 카드 생성 (단건/배열) |

## Response Format

```json
// 성공 (목록)
{
  "data": [...],
  "pagination": { "page": 1, "per_page": 50, "total": 120 }
}

// 성공 (단건)
{ "data": { ... } }

// 에러
{ "error": { "code": "INVALID_API_KEY", "message": "..." } }
```

## 파일 구조

| 파일 | 작업 |
|------|------|
| `supabase/migrations/006_api_keys.sql` | 신규 — api_keys 테이블 |
| `supabase/functions/api/index.ts` | 신규 — Hono Edge Function |
| `src/lib/api-key.ts` | 신규 — 키 생성/해싱 유틸 |
| `src/lib/api-validation.ts` | 신규 — 요청 검증 (순수 함수) |
| `src/lib/__tests__/api-key.test.ts` | 신규 — TDD |
| `src/lib/__tests__/api-validation.test.ts` | 신규 — TDD |
| `src/pages/SettingsPage.tsx` | 수정 — DB에 키 저장 |
