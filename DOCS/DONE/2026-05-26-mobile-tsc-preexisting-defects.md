# 모바일 기존 tsc 결함 디버깅: theme-store ColorSchemeName & i18next 타입 dedup

작성일: 2026-05-26 · 브랜치: `fix/mobile-tsc-preexisting` (off develop)

이전 작업(study-resume/card-layout, PR #98)에서 발견했으나 범위 밖이라 손대지 않은
기존 결함 2건을 근본 원인까지 디버깅한다.

## 결함 1 — `theme-store.ts:31` TS2345 (ColorSchemeName) — **수정 대상**

### 근본 원인
```ts
Appearance.setColorScheme(theme === 'system' ? null : theme)  // theme: 'light'|'dark'|'system'
```
- 설치된 react-native에서 `type ColorSchemeName = 'light' | 'dark' | 'unspecified'`
  (`node_modules/react-native/Libraries/Utilities/Appearance.d.ts:12`). **`null`이 아님.**
- `setColorScheme` JS 구현은 값을 그대로 `NativeAppearance.setColorScheme(colorScheme)`에
  전달(매핑 없음). 즉 "시스템 따름"의 올바른 값은 **`'unspecified'`**.
- 기존 코드는 `null`을 전달 → ① tsc 타입 오류 ② 런타임상 system 테마가 네이티브에
  정확히 반영되지 않을 수 있음(구버전 RN의 잔재). **기능적 버그 + 타입 오류.**

### 해결
- 순수 헬퍼 `utils/color-scheme.ts`의 `toAppearanceColorScheme(theme)`로 매핑
  (`system → 'unspecified'`, 그 외 → 그대로)을 분리 → 단위 테스트로 고정.
- `theme-store`가 헬퍼를 사용.

## 결함 2 — i18next 타입 dedup (App.tsx I18nextProvider) — **근본원인 규명 + 권고**

### 근본 원인 (전수 조사 결과)
- `packages/mobile`: `i18next ^24.2.2` + `react-i18next ^15.4.1` (의도적 구버전 고정)
- `packages/web`·`shared`: `i18next ^25.8.10` + `react-i18next ^16.5.4`
- 모노레포 hoist로 루트 `node_modules/i18next` = **25.8.18**, react-i18next@15는
  중첩 `react-i18next/node_modules/i18next` = **24.2.3** 사용.
- mobile의 `import i18n from './src/i18n'`가 hoist된 25로 해석되는데 react-i18next@15의
  `I18nextProvider`는 24 타입을 기대 → **메이저 불일치(TS2322)**.
- **런타임은 정상**(react-i18next@15 peer `i18next >=23.4.0` → 25 허용, 앱 정상 동작).

### 현재 상태 / 권고
- PR #98에서 단일 사용처에 `i18n={i18n as never}`(주석 포함)로 타입 전용 무해 우회 적용 →
  tsc 통과. 런타임 영향 0.
- **영구 해결 권고(별도 작업)**: mobile을 web/shared와 정렬 — `react-i18next ^16` +
  `i18next ^25`로 업그레이드 후 단일 메이저로 통일. **`pnpm install`(락파일 변경) +
  앱 런타임 검증(useTranslation/Trans/Provider)** 이 필요하므로, 공유 node_modules를
  쓰는 worktree가 아닌 **메인 저장소에서 앱 실행 검증과 함께** 수행해야 안전.
- 이 worktree에서는 검증 불가능한 의존성 변경을 강행하지 않는다(무검증 변경 = 反 zero-defect).

## 검증
- `tsc --noEmit` 0 에러(theme-store 수정 후; i18next는 develop의 캐스트로 이미 해소).
- `npx tsx utils/color-scheme.test.ts` — system→'unspecified', light/dark passthrough.
