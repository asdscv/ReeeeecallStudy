# 학습 중 백그라운드 복귀 리셋 & 카드 텍스트 가로 오버플로우 수정

작성일: 2026-05-26 · 브랜치: `fix/study-resume-nav-and-card-layout`

## 배경 (사용자 보고)

1. **네비 리셋**: 학습 중 앱을 백그라운드로 보냈다가 돌아오면 항상 대시보드로 이동.
   원래 보던 화면(학습 세션)으로 돌아가지 못해 학습을 처음부터 다시 시작해야 함.
2. **카드 레이아웃**: 학습 카드의 텍스트가 카드 폭을 넘어 가로로 잘리고, 옆으로
   스크롤해야 보임. CJK(중국어) 렌더링 수정 직후 발생한 것으로 추정.

## 근본 원인 분석 (Root Cause)

### Bug 1 — 백그라운드 복귀 시 대시보드 리셋
- `App.tsx`의 `NavigationContainer`에 **상태 영속화(`initialState`/`onStateChange`)가
  전혀 없음**.
- `RootNavigator`·`useAuthState`·전 화면을 전수 조사한 결과, 포그라운드 복귀 시
  네비게이션을 강제로 리셋하는 코드(`navigation.reset`, `Updates.reloadAsync`,
  `AppState` 리스너 등)는 **존재하지 않음**.
- 결론: iOS가 메모리 회수를 위해 백그라운드의 앱(학습 화면은 reanimated +
  gesture-handler + 다수 카드로 메모리 사용이 큼)을 종료 → 복귀 시 **cold-start** →
  React 트리 신규 마운트 → 네비게이터가 초기 라우트(Home/대시보드)에서 시작.
  영속화가 없어 마지막 위치가 복원되지 않음.

### Bug 2 — 카드 텍스트 가로 오버플로우
- 회귀 커밋: `d76904b` (TTS 행 레이아웃을 `flexDirection:'row' + flex:1 Text` →
  `width:'100%' Text` + 절대배치 스피커로 변경).
- `CardFace`의 스크롤 컨테이너(`cardScrollContent`)와 앞면 컨테이너(`cardContent`)가
  `alignItems:'center'`인데, 자식이 `width:'100%'`를 사용.
- iOS/Yoga에서 **세로 ScrollView의 contentContainer가 `alignItems:'center'`이면
  교차축(가로) 폭을 콘텐츠 기준(=긴 텍스트 한 줄의 폭)으로 측정** → `width:'100%'`가
  그 과대 폭으로 해석되어 텍스트가 줄바꿈되지 않고 가로로 넘침 → 가로 스크롤 발생.
- 이전에는 `flex:1` Text가 행의 제약 폭을 강제해 줄바꿈됐으나, 변경 후 폭 제약이 사라짐.

## 해결 설계 (Solution)

### Bug 1 — 네비게이션 상태 영속화
- **제약**: `@react-native-async-storage/async-storage` 미설치. 새 네이티브 모듈을
  추가하면 재빌드가 필요해 OTA 배포 불가. → **이미 빌드에 포함된
  `expo-file-system`(^55)** 사용 (OTA 호환).
- 모듈 분리 (관심사 분리 / 테스트 용이성):
  - `utils/nav-persistence-core.ts` — **순수 로직**(직렬화, 파싱, 신선도 가드).
    RN/expo 비의존 → tsx 단위 테스트 가능.
  - `utils/nav-persistence.ts` — **IO 어댑터**(`expo-file-system/legacy`로 파일 R/W).
- `App.tsx`: 부팅 시 `loadNavState()`로 복원 → `NavigationContainer initialState`,
  `onStateChange`에서 `saveNavState()`로 저장.
- **신선도 가드**: 마지막 저장이 `NAV_STATE_MAX_AGE_MS`(2시간) 이내일 때만 복원.
  오래된 상태는 무시하고 대시보드로 시작(자연스러운 동작).
- **학습 세션 cold-start 처리**: 학습 스토어(`crammingManager` 클래스 인스턴스 포함)는
  직렬화 불가하므로 세션 전체 복원은 범위 외. 복원 시 `StudySession`이 빈 세션으로
  마운트되면 기존 `phase==='idle'` 가드가 `goBack()` → 해당 덱의 `StudySetup`으로
  안전 착지(대시보드가 아님). warm 리마운트 시에는 스토어가 살아있어 세션 그대로 복원.

### Bug 2 — 텍스트 줄바꿈 복원
- `cardScrollContent`·`cardContent`의 `alignItems:'center'` → **`'stretch'`**.
  자식이 컨테이너(=정의된 카드 폭)로 늘어나 폭 제약이 확정 → 텍스트 정상 줄바꿈.
  텍스트는 `textAlign:'center'`로 여전히 가운데 정렬(시각적 동일).
- CJK 줄높이/볼드/스타일 계산을 `utils/card-text-style.ts`(순수)로 추출 → 단위 테스트.

## 테스트 (실증)
- `utils/nav-persistence-core.test.ts` — 신선도 가드(경계/만료/미래값), 손상 JSON,
  직렬화 라운드트립.
- `utils/card-text-style.test.ts` — CJK vs 비CJK 줄높이(1.8x/1.5x), 볼드/이탤릭/색상 분기.
- 실행: `npx tsx <file>` (기존 `i18n.test.ts` 컨벤션). + `tsc --noEmit` 통합 검증.

## OTA 배포 가능 여부
- 두 수정 모두 **JS-only** (새 네이티브 모듈 없음) → `eas update`로 양 플랫폼 배포 가능.
