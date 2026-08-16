# ARCHITECTURE STANDARD — ReeeeecallStudy (이전됨)

> **이 문서는 2026-08-16 에 번호 붙은 표준 트리로 확장·이전되었다.**
> 새 진입점: **[`DOCS/STANDARD/README.md`](README.md)** · 제1원칙: [`01_ARCHITECTURE/modular_composition.md`](01_ARCHITECTURE/modular_composition.md)
>
> 이 파일은 기존 인용(`DOCS/DONE/**`, 설계 문서들)이 깨지지 않도록 **길잡이로 남긴다.**
> 새 문서에서는 이 파일이 아니라 아래 카테고리를 인용한다.

## 이전 위치

| 옛 절 | 지금 위치 |
|---|---|
| §1 Monorepo layout | [`01_ARCHITECTURE/README.md`](01_ARCHITECTURE/README.md) + [`modular_composition.md §2`](01_ARCHITECTURE/modular_composition.md#2-계층--모듈이-살-수-있는-자리) |
| §2 Database & migrations | [`04_DATABASE/README.md`](04_DATABASE/README.md) |
| §3 Edge functions | [`03_SERVER_CONTRACT/README.md`](03_SERVER_CONTRACT/README.md) · [`11_SECURITY/README.md`](11_SECURITY/README.md) |
| §4 Client conventions | [`02_CLIENT/README.md`](02_CLIENT/README.md) · [`10_I18N/README.md`](10_I18N/README.md) · [`12_MOBILE/README.md`](12_MOBILE/README.md) |
| §5 Extensibility | [`01_ARCHITECTURE/modular_composition.md §6`](01_ARCHITECTURE/modular_composition.md#6-값은-코드가-아니라-데이터로) · [`§8`](01_ARCHITECTURE/modular_composition.md#8-확장-메커니즘-5종--쪼갠다를-어떤-형태로-하나) · [`05_AI_AND_MONEY/README.md`](05_AI_AND_MONEY/README.md) |
| §6 Definition of done | [`07_TESTING/README.md §7`](07_TESTING/README.md#7-definition-of-done) |

## 이전하면서 바로잡은 것 (옛 본문이 사실과 달랐던 부분)

1. **"Web re-exports shared stores/lib"** — 실제로는 세 방식이 공존한다(shim 11 · 웹 전용 5 · **shared 와 별개 구현 3**). `lib` 은 동명 파일 53개 중 shim 이 3개뿐이고(바이트 동일 사본 36) **14개는 이미 갈라졌다**. → [`02_CLIENT §1`](02_CLIENT/README.md), 부채 D4·D5.
2. **"All writes go through SECURITY DEFINER RPCs — no direct INSERT/UPDATE"** — 사용자 소유 콘텐츠 테이블 9개는 **인정된 예외**이고, mig 136 이 그 전제 위에 트리거 백스톱을 놓았다. → [`04_DATABASE §3`](04_DATABASE/README.md).
3. **"Supabase auto-grants EXECUTE to anon + authenticated"** — 정확히는 **Postgres 가 PUBLIC 에 EXECUTE 를 준다.** 그래서 `REVOKE ... FROM PUBLIC`(mig 098)이 service_role 의 암묵적 EXECUTE 까지 벗겨 REST API 인증이 전부 401 로 떨어지는 사고가 났고, mig 107 이 service_role 에만 다시 GRANT 해 복구했다. → [`11_SECURITY §2`](11_SECURITY/README.md).
4. **무료 쿼터의 단일 출처가 `_ai_free_cards_per_day`** — mig 239 가 `ai_free_allowances` 테이블 + `_ai_free_allowance()` 리졸버로 옮겼다. → [`05_AI_AND_MONEY §4`](05_AI_AND_MONEY/README.md).
5. 옛 문서에 아예 없던 규약: BEGIN/COMMIT 래핑 · DROP-then-CREATE · errcode 어휘 · `prod-migrations-applied` 승격 게이트 · SQL 스위트 CI 등록. (`rollbacks/` 는 폴더 이름으로만 나왔고 롤백 파일을 쓴다는 규칙은 없었다 — 그 규칙이 새로 생겼다.)
