# 12. 모바일 (React Native / Expo)

> 모바일 결함은 **유닛 테스트로 안 잡히고 화면을 봐야 보인다.**
> raw i18n 키, 다크모드 대비 실패, 0-based 번호, 마법사가 첫 모드에 머무름 — 전부 시뮬레이터에서만 드러났다.
> 그래서 이 문서의 마지막 절은 "어떻게 실제로 띄워 보는가"다.

## 목차
- [1. 모바일에만 있는 런타임 제약](#1-모바일에만-있는-런타임-제약)
- [2. 저장소](#2-저장소)
- [3. 네비게이션](#3-네비게이션)
- [4. 데이터와 인증](#4-데이터와-인증)
- [5. 테마와 디자인 토큰](#5-테마와-디자인-토큰)
- [6. 테스트](#6-테스트)
- [7. 실기기/시뮬레이터로 확인하기](#7-실기기시뮬레이터로-확인하기)

---

## 1. 모바일에만 있는 런타임 제약

| 없는 것 | 결과 | 대응 |
|---|---|---|
| **full ICU** | `Intl`/`toLocaleString` 이 조용히 다른 값을 낸다(천단위 소실, 미국식 날짜) | `packages/shared/lib/format-number.ts` + `calendarParts()` → [`../10_I18N §3`](../10_I18N/README.md) |
| **전역 `crypto`** | `crypto.randomUUID()` 가 ReferenceError → 퀴즈 생성·채점이 모바일에서만 죽었다 | `newPersistenceId()` |
| **`window` / `document` / `localStorage`** | shared 코드가 이것들을 쓰면 모바일 런타임에서만 터진다(현재 실제 참조는 2파일 — `auth-store.ts` 의 `window.location.origin` 3곳, `subscription-store.ts` 의 개발 전용 `typeof window` 가드) | `packages/shared/adapters` 포트 |
| **동적 require 경로** | 번들러가 리터럴만 인식 → i18n resources 를 8×18 정적 require 로 하드코딩 | 그대로 유지 |
| **네이티브 모듈의 존재 보장** | OTA 로 JS 만 도달한 설치본에는 네이티브 모듈이 없다 | 런타임 존재 확인 후 UI 활성화 |

## 2. 저장소

| 규칙 | 이유 |
|---|---|
| 로컬 환경설정은 **`packages/mobile/src/utils/local-prefs.ts`(expo-secure-store)로만** 접근한다 | AsyncStorage/MMKV 는 네이티브 리빌드가 필요해 **OTA 를 깨뜨린다** |
| raw `SecureStore.*` 호출은 인프라 파일 3개(`rn-storage.ts`·`local-prefs.ts`·`rn-device.ts`)에만 | 실측 준수 |
| 세션 저장은 **500자 청킹 + 매니페스트를 나중에 쓰기** | expo-secure-store 는 값당 2048바이트 초과를 거부하는데 Supabase 세션은 빈 계정에서도 1963바이트(96%)다. 매니페스트를 먼저 쓰면 크래시 시 존재하지 않는 청크를 가리킨다 |
| `setItem` 은 **절대 reject 하지 않는다** | reject 하면 Supabase 로그인 경로 자체가 중단된다 |

## 3. 네비게이션

- 스택 파일 8개 + Drawer (`packages/mobile/src/navigation/` — `createNativeStackNavigator` 18개 · `createDrawerNavigator` 2개).
- 화면 추가 = `<Stack.Screen>` + `types.ts` 의 ParamList 키. AI 계열이면 `aiHubRoutes.ts` 의 `AI_HUB_STACK_SCREENS` 도.
- **★ 스택 화면은 한 번만 마운트된다.** `route.params` 를 `useState` 초기값으로 읽으면 **두 번째 진입에서 갱신되지 않는다** — 덱 생성에서 AI 를 누르고 다시 카드 생성에서 누르면 마법사가 첫 모드에 머물렀다. `useEffect`/`useMemo` 로 params 변화를 반영한다.
- 공유 카탈로그가 모바일 화면 이름을 **평문 문자열**로 들고 있으므로(`ai/hub/types.ts`), 화면 rename 은 컴파일을 통과하고 **런타임 메뉴만 깨진다.** 그래서 `aiHubRoutes.ts` 가 그 문자열을 타입으로 되받는다 — 화면 이름을 바꾸면 이 파일을 같이 고친다.
- 화면 데이터 갱신은 mount 가 아니라 **`useFocusEffect`** 로 한다(다른 화면에서 수정하고 돌아왔을 때 stale 방지).

## 4. 데이터와 인증

- 화면은 스토어를 직접 구독하지 않고 `packages/mobile/src/hooks/{useDecks,useCards,useStudy,useDashboardData}` 래퍼 훅을 쓴다.
  (예외 13개 화면이 `getMobileSupabase()` 로 직접 쿼리 중 — 새 화면은 훅을 만든다.)
- **모바일 인증은 `useAuthState.ts` 가 관리한다.** shared `useAuthStore` 는 모바일에서 `initialize()` 되지 않으므로 `user` 가 **영원히 null** 이다 → 모바일 화면에서 `useAuthStore(s => s.user?.id)` 를 읽는 코드는 죽은 분기다(현재 `LearningGoalsScreen` 이 그 상태).
- shared `auth-store` 의 `signUp`/`signInWithProvider`/`resetPassword` 는 `window.location.origin` 을 쓴다. 모바일에서는 크래시하지 않고 **자체 try/catch 에 잡혀 `{ error }` 로 조용히 실패**하므로 더 찾기 어렵다. 모바일은 `useAuth.ts` 를 쓴다.

## 5. 테마와 디자인 토큰

- 토큰 SSOT 는 `packages/shared/design-tokens/`(colors·typography·spacing·radius·shadows).
- 모바일은 `packages/mobile/src/theme/` 가 이것을 읽는다. 테마 결정 순서: **사용자 설정 → `useColorScheme()`(OS)**.
- ⚠️ **웹은 토큰을 import 하지 않는다.** `packages/web/src/index.css` 와 `styles/theme.css` 가 *"synced with shared/design-tokens"* 라는 **주석만 달고 값을 손으로 복사**한다 → 토큰을 바꾸면 두 곳을 같이 고쳐야 하고, 이를 잡는 게이트가 없다(부채).
- 다크모드 대비를 눈으로 확인한다 — 기본 버튼 텍스트가 다크모드에서 **2.54:1** 로 AA 미달이었던 적이 있다.
- `theme-store` 의 `system` 은 RN 계약상 `'unspecified'` 로 매핑해야 한다(`null` 이 아니다) — `color-scheme.test.ts` 가 이 계약을 고정한다.

## 6. 테스트

- 모바일 단위 테스트는 vitest 가 아니라 **`npx tsx <file>` 로 도는 손수 스크립트**다(자체 `check()` + `process.exit(failed>0?1:0)`). 파일 헤더에 실행법을 주석으로 적는다.
- **6개 중 CI 가 도는 것은 `i18n.test.ts` 하나뿐**이다. 나머지 5개는 사람이 기억해야 돈다.
  → 새 모바일 테스트를 만들면 **`ci.yml` 의 `unit-tests` job 에 `npx tsx` 스텝을 추가**하거나, 로직을 shared 로 올려 웹 vitest 가 보게 한다(후자가 낫다).
- 모바일 타입체크는 CI 게이트가 아니다(marketplace 스코프 밖은 통과) → **로컬에서 `tsc --noEmit` 을 직접 돌린다.**
- e2e 는 WebdriverIO + Appium 14 spec, CI 에 없다.

## 7. 실기기/시뮬레이터로 확인하기

**모바일 화면을 건드린 PR 의 완료 조건에 포함된다.** 유닛 테스트가 볼 수 없는 것들이 여기서만 보인다.

띄우기 전에 막히는 것들(매번 3~4개씩 나온다):
- **Supabase 는 플랫폼당 활성 세션 1개**다 → Playwright 와 모바일 하네스가 서로를 킥한다. 하나씩 돌린다.
- 안드로이드 에뮬레이터는 Metro 에 **`10.0.2.2:8081`** 로만 도달한다.
- 온보딩·비밀번호 시트·햄버거 메뉴가 화면을 가려 자동화가 요소를 못 찾는 경우가 있다(testID 확인).
- 브랜치 코드를 보려면 **그 브랜치로 직접 빌드**해야 한다.

확인 항목:
- [ ] raw i18n 키가 보이지 않는가 (`insights.title` 같은 문자열)
- [ ] 숫자·날짜가 로케일에 맞는가 (Hermes ICU 부재)
- [ ] 다크모드 대비가 읽을 만한가
- [ ] 같은 화면에 **두 번 진입**했을 때 상태가 갱신되는가 (스택 마운트 1회)
- [ ] 네이티브 모듈 의존 UI 가 없는 빌드에서 죽지 않는가

## 관련 문서
[`../02_CLIENT`](../02_CLIENT/README.md) · [`../10_I18N`](../10_I18N/README.md) · [`../09_DEPLOYMENT §6`](../09_DEPLOYMENT/README.md#6-모바일--ota-인가-네이티브인가) · `DOCS/MOBILE/13-TESTING.md`
