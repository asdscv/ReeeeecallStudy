# 01. Architecture — Monorepo & Shared Code

> **Status**: Draft
> **Last Updated**: 2026-03-16

---

## Monorepo Structure

```
reeeeecall/
├── packages/
│   ├── shared/                    ← Web + Mobile 공유 코드
│   │   ├── types/                 ← DB 스키마, 도메인 타입
│   │   │   ├── database.ts
│   │   │   └── content-blocks.ts
│   │   ├── lib/                   ← 비즈니스 로직
│   │   │   ├── srs.ts             ← SRS 알고리즘
│   │   │   ├── study-queue.ts     ← 학습 큐 관리
│   │   │   ├── card-utils.ts      ← 카드 유틸리티
│   │   │   ├── date-utils.ts      ← 날짜 유틸리티
│   │   │   ├── password-validation.ts
│   │   │   ├── api-key.ts
│   │   │   ├── tier-config.ts     ← 구독 티어 설정
│   │   │   ├── ai/                ← AI 클라이언트 (프로바이더, 프롬프트)
│   │   │   │   ├── ai-client.ts
│   │   │   │   ├── providers/
│   │   │   │   ├── prompts.ts
│   │   │   │   ├── validators.ts
│   │   │   │   └── types.ts
│   │   │   └── ... (50+ pure TS files)
│   │   ├── stores/                ← Zustand 스토어
│   │   │   ├── auth-store.ts      ← (플랫폼 어댑터 주입)
│   │   │   ├── deck-store.ts
│   │   │   ├── card-store.ts
│   │   │   ├── study-store.ts
│   │   │   ├── template-store.ts
│   │   │   ├── ai-generate-store.ts
│   │   │   ├── marketplace-store.ts
│   │   │   ├── subscription-store.ts
│   │   │   └── ...
│   │   ├── adapters/              ← 플랫폼 추상화 인터페이스
│   │   │   ├── storage.ts         ← IStorage (localStorage ↔ AsyncStorage)
│   │   │   ├── crypto.ts          ← ICrypto (Web Crypto ↔ expo-crypto)
│   │   │   ├── device.ts          ← IDevice (navigator ↔ expo-device)
│   │   │   ├── tts.ts             ← ITTS (Web Speech ↔ expo-speech)
│   │   │   └── audio.ts           ← IAudio (HTMLAudio ↔ expo-av)
│   │   └── supabase.ts            ← Supabase 클라이언트 (공유)
│   │
│   ├── web/                       ← 현재 웹앱 (변경 최소화)
│   │   ├── src/
│   │   │   ├── adapters/          ← Web 구현체
│   │   │   │   ├── web-storage.ts
│   │   │   │   ├── web-crypto.ts
│   │   │   │   ├── web-device.ts
│   │   │   │   └── web-tts.ts
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── pages/
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── mobile/                    ← React Native 앱
│       ├── src/
│       │   ├── adapters/          ← RN 구현체
│       │   │   ├── rn-storage.ts  ← MMKV / expo-secure-store
│       │   │   ├── rn-crypto.ts   ← expo-crypto
│       │   │   ├── rn-device.ts   ← expo-device
│       │   │   └── rn-tts.ts      ← expo-speech
│       │   ├── screens/           ← 화면 (Pages → Screens)
│       │   ├── components/        ← RN 컴포넌트
│       │   ├── navigation/        ← React Navigation 설정
│       │   ├── hooks/             ← RN 전용 훅
│       │   └── App.tsx
│       ├── app.json               ← Expo 설정
│       ├── eas.json               ← EAS Build 설정
│       └── package.json
│
├── package.json                   ← Workspace root
├── tsconfig.base.json             ← 공유 TS 설정
└── turbo.json                     ← Turborepo 설정 (선택)
```

---

## Adapter Pattern (핵심 설계)

브라우저 API에 의존하는 5개 모듈을 **인터페이스 + 구현체** 패턴으로 분리합니다.

### Interface 정의 (shared/adapters/)

```typescript
// shared/adapters/storage.ts
export interface IStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

// shared/adapters/crypto.ts
export interface ICryptoAdapter {
  encrypt(plaintext: string, uid: string): Promise<string>
  decrypt(ciphertext: string, uid: string): Promise<string>
  getRandomBytes(length: number): Uint8Array
  sha256(input: string): Promise<string>
}

// shared/adapters/device.ts
export interface IDeviceAdapter {
  getUniqueId(): Promise<string>
  getUserAgent(): string
  getDeviceType(): 'mobile' | 'tablet' | 'desktop'
  getPlatform(): 'ios' | 'android' | 'web'
}

// shared/adapters/tts.ts
export interface ITTSAdapter {
  speak(text: string, lang: string, rate?: number): Promise<void>
  stop(): void
  isSupported(): boolean
}

// shared/adapters/audio.ts
export interface IAudioAdapter {
  play(url: string): Promise<void>
  stop(): void
}
```

### Platform Registry

```typescript
// shared/adapters/index.ts
let _storage: IStorage
let _crypto: ICryptoAdapter
let _device: IDeviceAdapter
let _tts: ITTSAdapter

export function initAdapters(adapters: {
  storage: IStorage
  crypto: ICryptoAdapter
  device: IDeviceAdapter
  tts: ITTSAdapter
}) {
  _storage = adapters.storage
  _crypto = adapters.crypto
  _device = adapters.device
  _tts = adapters.tts
}

export function getStorage(): IStorage { return _storage }
export function getCrypto(): ICryptoAdapter { return _crypto }
export function getDevice(): IDeviceAdapter { return _device }
export function getTTS(): ITTSAdapter { return _tts }
```

### 초기화 (각 플랫폼)

```typescript
// web/src/main.tsx
import { initAdapters } from '@reeeeecall/shared/adapters'
import { WebStorage } from './adapters/web-storage'
import { WebCrypto } from './adapters/web-crypto'
// ...
initAdapters({
  storage: new WebStorage(),
  crypto: new WebCrypto(),
  device: new WebDevice(),
  tts: new WebTTS(),
})

// mobile/src/App.tsx
import { initAdapters } from '@reeeeecall/shared/adapters'
import { RNStorage } from './adapters/rn-storage'
import { RNCrypto } from './adapters/rn-crypto'
// ...
initAdapters({
  storage: new RNStorage(),
  crypto: new RNCrypto(),
  device: new RNDevice(),
  tts: new RNTTS(),
})
```

---

## Dependency Flow

```
┌─────────────────────────────────────────────────┐
│                   shared/                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  types/  │  │  stores/ │  │   adapters/   │  │
│  │          │  │          │  │  (interfaces) │  │
│  └──────────┘  └────┬─────┘  └──────┬────────┘  │
│                     │               │            │
│              ┌──────┴──────┐        │            │
│              │    lib/     │◄───────┘            │
│              │ (pure logic)│                     │
│              └─────────────┘                     │
└───────────────────┬─────────────────┬────────────┘
                    │                 │
        ┌───────────┴──┐     ┌───────┴────────┐
        │    web/      │     │    mobile/     │
        │  adapters/   │     │   adapters/    │
        │  (Web impl)  │     │   (RN impl)   │
        │  components/ │     │   screens/     │
        │  pages/      │     │   components/  │
        └──────────────┘     └────────────────┘
```

---

## Migration Strategy (웹 깨뜨리지 않기)

### Phase 1: 추출 (Non-breaking)
1. `packages/shared/` 디렉토리 생성
2. `src/types/` → `packages/shared/types/` 복사
3. `src/lib/` 중 순수 파일 → `packages/shared/lib/` 복사
4. 웹에서 import path를 alias로 변경 (`@shared/...`)
5. 웹 빌드 확인 — 기존 동작 변경 없음

### Phase 2: 어댑터 도입 (Breaking for 5 files)
1. `shared/adapters/` 인터페이스 정의
2. 브라우저 의존 5개 파일을 어댑터 사용으로 변경
3. `web/src/adapters/` 에 Web 구현체 작성
4. 웹 entry point에서 `initAdapters()` 호출
5. 웹 전체 테스트 통과 확인

### Phase 3: 모바일 시작
1. `packages/mobile/` Expo 프로젝트 생성
2. `mobile/src/adapters/` 에 RN 구현체 작성
3. 화면 하나씩 구현 시작

---

## Package Manager & Tooling

| Tool | Purpose |
|------|---------|
| **pnpm workspaces** | Monorepo 패키지 관리 |
| **TypeScript** | `tsconfig.base.json` 공유, 각 패키지에서 extends |
| **Turborepo** (선택) | 빌드 캐시, 병렬 실행 |
| **EAS Build** | React Native 빌드 (iOS/Android) |
| **EAS Submit** | 스토어 제출 자동화 |
