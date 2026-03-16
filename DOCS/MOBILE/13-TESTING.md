# 13. Mobile Testing — Appium (iOS + Android)

> **Status**: Draft
> **Last Updated**: 2026-03-16
> **Framework**: Appium 2.x + WebDriverIO
> **Scope**: iOS + Android 크로스플랫폼 E2E 테스트

---

## Why Appium?

| 기준 | Appium | Detox |
|------|--------|-------|
| 크로스플랫폼 | iOS + Android (동일 API) | iOS + Android |
| React Native 외 지원 | Native, Hybrid, Flutter 등 | RN 전용 |
| 언어 | JS/TS, Python, Java 등 | JS/TS only |
| CI/CD 호환 | 범용 (모든 CI) | 범용 |
| 커뮤니티 | 매우 큼 (업계 표준) | RN 커뮤니티 중심 |
| 실제 디바이스 테스트 | BrowserStack, Sauce Labs 등 | 제한적 |

**선택 이유**: 업계 표준 + 실제 디바이스 클라우드 테스트 지원 + 향후 네이티브 모듈 확장 시 유연성

---

## Tech Stack

```
Appium 2.x              ← 테스트 서버
├── appium-xcuitest-driver   ← iOS (XCUITest)
├── appium-uiautomator2-driver ← Android (UiAutomator2)
WebDriverIO (wdio)       ← 테스트 러너 + 클라이언트
Jest                     ← 단위/통합 테스트 (shared 로직)
```

---

## Directory Structure

```
packages/mobile/
├── __tests__/
│   ├── unit/                    ← Jest 단위 테스트
│   │   ├── adapters/
│   │   └── utils/
│   └── e2e/                     ← Appium E2E 테스트
│       ├── specs/               ← 테스트 파일
│       │   ├── auth.spec.ts     ← 로그인/회원가입
│       │   ├── deck.spec.ts     ← 덱 CRUD
│       │   ├── study.spec.ts    ← 학습 플로우
│       │   ├── settings.spec.ts ← 설정
│       │   └── purchase.spec.ts ← 인앱 결제
│       ├── screens/             ← Page Object Model
│       │   ├── LoginScreen.ts
│       │   ├── HomeScreen.ts
│       │   ├── DeckScreen.ts
│       │   ├── StudyScreen.ts
│       │   └── SettingsScreen.ts
│       ├── helpers/             ← 테스트 유틸리티
│       │   ├── gestures.ts      ← 스와이프, 탭 등
│       │   ├── wait.ts          ← 대기 유틸
│       │   └── auth.ts          ← 로그인 헬퍼
│       └── wdio.conf.ts         ← WebDriverIO 설정
├── wdio.ios.conf.ts             ← iOS 전용 설정
├── wdio.android.conf.ts         ← Android 전용 설정
└── jest.config.ts               ← Jest 설정 (단위 테스트)
```

---

## Setup

### 1. Dependencies

```bash
# Appium & drivers
pnpm --filter @reeeeecall/mobile add -D \
  appium \
  @wdio/cli \
  @wdio/local-runner \
  @wdio/mocha-framework \
  @wdio/spec-reporter \
  webdriverio \
  ts-node

# Appium drivers (global)
appium driver install xcuitest
appium driver install uiautomator2
```

### 2. Prerequisites

| Platform | Requirement |
|----------|-------------|
| **iOS** | macOS + Xcode + iOS Simulator |
| **Android** | Android Studio + Emulator + ANDROID_HOME 설정 |
| **Both** | Java JDK 11+, Node.js 18+ |

### 3. Environment Variables

```bash
# .env.test
APPIUM_HOST=localhost
APPIUM_PORT=4723
IOS_DEVICE_NAME="iPhone 16"
IOS_PLATFORM_VERSION="18.0"
ANDROID_DEVICE_NAME="Pixel_8_API_35"
ANDROID_PLATFORM_VERSION="15"
```

---

## Configuration

### wdio.conf.ts (공통)

```typescript
import type { Options } from '@wdio/types'

export const config: Options.Testrunner = {
  runner: 'local',
  tsConfigPath: './tsconfig.json',
  specs: ['./__tests__/e2e/specs/**/*.spec.ts'],
  maxInstances: 1,
  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
}
```

### wdio.ios.conf.ts

```typescript
import { config as sharedConfig } from './wdio.conf'

export const config = {
  ...sharedConfig,
  capabilities: [{
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': process.env.IOS_DEVICE_NAME ?? 'iPhone 16',
    'appium:platformVersion': process.env.IOS_PLATFORM_VERSION ?? '18.0',
    'appium:app': './ios/build/ReeeeecallStudy.app',
    'appium:noReset': false,
  }],
  port: 4723,
}
```

### wdio.android.conf.ts

```typescript
import { config as sharedConfig } from './wdio.conf'

export const config = {
  ...sharedConfig,
  capabilities: [{
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': process.env.ANDROID_DEVICE_NAME ?? 'Pixel_8_API_35',
    'appium:platformVersion': process.env.ANDROID_PLATFORM_VERSION ?? '15',
    'appium:app': './android/app/build/outputs/apk/debug/app-debug.apk',
    'appium:noReset': false,
  }],
  port: 4723,
}
```

---

## Test Patterns

### Page Object Model (POM)

```typescript
// __tests__/e2e/screens/LoginScreen.ts
class LoginScreen {
  get emailInput() { return $('~login-email-input') }
  get passwordInput() { return $('~login-password-input') }
  get loginButton() { return $('~login-submit-button') }
  get errorText() { return $('~login-error-text') }

  async login(email: string, password: string) {
    await this.emailInput.setValue(email)
    await this.passwordInput.setValue(password)
    await this.loginButton.click()
  }
}

export default new LoginScreen()
```

### testID Convention

React Native 컴포넌트에 `testID`를 부여하면 Appium에서 `~testID`로 접근 가능:

```tsx
// components/LoginForm.tsx
<TextInput
  testID="login-email-input"
  placeholder="Email"
/>
<TouchableOpacity testID="login-submit-button">
  <Text>Login</Text>
</TouchableOpacity>
```

### Naming Convention

```
testID 패턴: {screen}-{element}-{type}

예시:
  login-email-input
  login-submit-button
  home-deck-list
  study-flip-button
  study-rating-good
  settings-logout-button
```

---

## Test Scenarios

### Phase 2: Auth

| # | Scenario | iOS | Android |
|---|----------|-----|---------|
| A1 | 이메일 회원가입 → 로그인 | ☐ | ☐ |
| A2 | Google 소셜 로그인 | ☐ | ☐ |
| A3 | Apple 소셜 로그인 | ☐ | N/A |
| A4 | 비밀번호 재설정 플로우 | ☐ | ☐ |
| A5 | 로그아웃 → 재로그인 | ☐ | ☐ |
| A6 | 세션 만료 처리 | ☐ | ☐ |

### Phase 3: Core

| # | Scenario | iOS | Android |
|---|----------|-----|---------|
| C1 | 덱 생성 → 목록 표시 | ☐ | ☐ |
| C2 | 카드 추가 → 수정 → 삭제 | ☐ | ☐ |
| C3 | 덱 삭제 (확인 다이얼로그) | ☐ | ☐ |
| C4 | 빈 상태 (덱 없음) 표시 | ☐ | ☐ |

### Phase 4: Study

| # | Scenario | iOS | Android |
|---|----------|-----|---------|
| S1 | 카드 플립 (탭) | ☐ | ☐ |
| S2 | 스와이프 평가 (좌/우/상) | ☐ | ☐ |
| S3 | 학습 요약 화면 | ☐ | ☐ |
| S4 | TTS 재생 | ☐ | ☐ |
| S5 | 벼락치기 모드 | ☐ | ☐ |

### Phase 5: Features

| # | Scenario | iOS | Android |
|---|----------|-----|---------|
| F1 | AI 카드 생성 | ☐ | ☐ |
| F2 | 마켓플레이스 탐색 → 다운로드 | ☐ | ☐ |
| F3 | 설정 변경 (TTS, 언어) | ☐ | ☐ |

### Phase 6: Monetization

| # | Scenario | iOS | Android |
|---|----------|-----|---------|
| M1 | Pro 구독 구매 (Sandbox) | ☐ | ☐ |
| M2 | 구독 복원 | ☐ | ☐ |
| M3 | Free 제한 도달 → 업그레이드 유도 | ☐ | ☐ |

---

## Scripts (package.json)

```json
{
  "scripts": {
    "test": "jest --config jest.config.ts",
    "test:e2e:ios": "appium & sleep 3 && wdio wdio.ios.conf.ts; kill %1",
    "test:e2e:android": "appium & sleep 3 && wdio wdio.android.conf.ts; kill %1",
    "test:e2e:all": "pnpm test:e2e:ios && pnpm test:e2e:android",
    "appium": "appium --port 4723"
  }
}
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Mobile E2E Tests

on:
  pull_request:
    paths: ['packages/mobile/**', 'packages/shared/**']

jobs:
  test-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: appium driver install xcuitest
      - name: Build iOS
        run: pnpm --filter @reeeeecall/mobile ios:build
      - name: Run Appium E2E (iOS)
        run: pnpm --filter @reeeeecall/mobile test:e2e:ios

  test-android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 35
          script: pnpm --filter @reeeeecall/mobile test:e2e:android
```

### 디바이스 클라우드 (선택)

| Service | 특징 |
|---------|------|
| **BrowserStack** | Appium 네이티브 지원, 실제 디바이스 |
| **Sauce Labs** | Appium 창시자 운영, 가장 넓은 디바이스 커버리지 |
| **AWS Device Farm** | AWS 생태계 통합 |

---

## Best Practices

1. **testID는 모든 인터랙션 요소에 필수** — Appium selector 안정성 확보
2. **Page Object Model** 사용 — 화면 변경 시 테스트 수정 최소화
3. **테스트 독립성** — 각 테스트는 독립 실행 가능 (noReset + 매 테스트 로그인)
4. **Wait 전략** — 하드코딩 sleep 금지, `waitForDisplayed()` / `waitForExist()` 사용
5. **스크린샷** — 실패 시 자동 스크린샷 (wdio `afterTest` hook)
6. **iOS/Android 분기** — `driver.isIOS` / `driver.isAndroid`로 플랫폼별 처리
