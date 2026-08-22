# Integration Tests — Real Supabase

표준 준거: `DOCS/STANDARD/07_TESTING`

## Run locally

```bash
pnpm test:integration
```

이 한 줄이 스택을 띄우고(마이그레이션 전부 적용), 키를 읽어 넣고, 스위트를 돌리고,
**성공하든 실패하든 스택을 내린다.** 루트에서 실행된다 — `vitest.config.ts` 의
`include` 글롭이 작업 디렉터리 기준이기 때문.

### 왜 손으로 띄우지 않나

`supabase start` 가 만드는 컨테이너는 `restart: unless-stopped` 다. 한 번 띄우면
이후 Docker 엔진이 뜨는 모든 순간에 스택 12개가 통째로 되살아나고, 아무도 그걸
알아채지 못한다(실제로 40시간 상주한 적이 있다). `pnpm test:integration` 은
`scripts/local-supabase.sh` 를 거치므로 그런 상태를 남기지 않는다.

스택을 띄운 채로 이것저것 해봐야 한다면 `supabase start` 대신:

```bash
pnpm db:up      # 띄우되 restart 정책을 no 로 되돌려 둔다 (부활 방지)
pnpm db:down    # 내린다
```

### 환경변수

스위트는 `SUPABASE_LOCAL_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
를 읽고, **없으면 통째로 skip 한다**(CI-safe). `pnpm test:integration` 은 이 셋을
`supabase status` 에서 읽어 자동으로 넣어주므로 직접 export 할 일이 없다.

## CI

`.github/workflows/ci.yml` 의 `Integration (Supabase)` 잡이 `supabase/setup-cli`
로 CLI 를 깔고 `.github/scripts/supabase-up.sh` 로 스택을 올린다 — 로컬 경로도
같은 스크립트를 쓰므로 "스택이 떴다"의 정의가 갈라지지 않는다.

⚠️ CI 는 CLI 를 **2.95.4 로 핀**하고 있다(2.107.0 이 `db reset` 에서 anon/
authenticated 기본 DML 그랜트를 안 주게 바뀌어 통합 그랜트가 깨졌다). 로컬 CLI 가
더 최신이면 여기서만 나는 권한 오류가 있을 수 있으니, 실패를 코드 탓으로 돌리기
전에 `supabase --version` 을 먼저 본다.

## 마이그레이션 체인만 확인하고 싶을 때

```bash
pnpm db:verify   # CI 의 Migration Safety 잡과 동일: reset 2회(멱등성) 후 자동 정리
```
