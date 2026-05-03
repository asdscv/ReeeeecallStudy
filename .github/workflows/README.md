# GitHub Actions Workflows

## ci.yml — Continuous Integration

main / develop 브랜치 push + PR 시 자동 실행.

| Job | Required | 내용 |
|---|---|---|
| `lint-typecheck` | yes | web ESLint + tsc --noEmit, mobile typecheck (marketplace 스코프 회귀만 차단) |
| `unit-tests` | **partial** | marketplace 스코프 테스트 강제, 전체 suite는 informational |
| `integration-tests` | yes | 실 supabase 컨테이너 + atomic acquire RPC 검증 |
| `arch-guard` | yes | 도메인 레이어가 supabase를 import하지 않음 |
| `migration-safety` | yes | 모든 마이그레이션이 fresh DB에서 idempotent하게 적용 |

### Baseline 정책

`unit-tests` 의 "REQUIRED" 단계는 우리가 추가/수정한 파일만 강제. develop 브랜치의 기존 부채 (예: `guide.json` i18n 누락, `marketplace-reviews.test.ts` 의 supabase 미초기화 이슈 100건)는 별도 cleanup PR에서 처리한다.

신규 도메인 코드 추가 시 해당 파일 path를 "REQUIRED" 단계에 명시 추가. 점진적으로 informational → required 로 이행.

---

## deploy-mobile.yml — Mobile Deployment

main 브랜치 push 시 자동 실행. `packages/mobile/` 또는 `packages/shared/` 변경된 경우만.

### 자동 분기

| 변경 종류 | 감지 | 동작 |
|---|---|---|
| JS-only (TS/JSX, i18n) | android/ios/app.json/app.config.js 미변경 | **OTA update** (즉시 반영) |
| Native (plugins, native code) | android/ios/app.json/app.config.js 변경 | **EAS Build** (빌드 후 수동 submit) |

### 필수 시크릿

```
EXPO_TOKEN  — Expo Personal Access Token
```

설정 방법:
1. https://expo.dev/accounts/asdscv/settings/access-tokens 에서 토큰 발급
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret
3. Name: `EXPO_TOKEN`, Value: 발급받은 토큰

미설정 시 워크플로는 자연스럽게 skip되며 (warning만 표시), 로컬에서 `eas update` 수동 실행으로 fallback 가능.

### 수동 실행

`Actions` 탭 → `Deploy Mobile` → `Run workflow` → `mode: ota | native | auto` 선택.

### 로컬 fallback (CI 우회)

```bash
cd packages/mobile
eas update --branch production --environment production --message "..."
```

---

## 보안 가이드

- 워크플로는 PR 머지 권한이 있는 reviewer 의 승인이 있을 때만 secrets에 접근 가능 (GitHub default).
- `EXPO_TOKEN` 은 fork된 PR 에서 노출되지 않음 — `pull_request` 이벤트는 secrets 접근 차단.
- `secrets.GITHUB_TOKEN` 은 자동 발급, 별도 설정 불필요.
