# 04. Phase 1 — Setup & Monorepo

> **Status**: Draft
> **Duration**: ~1 week
> **Prerequisites**: Node.js 18+, pnpm, Expo CLI

---

## Goals

- [ ] Expo 프로젝트 초기화
- [ ] pnpm workspace monorepo 설정
- [ ] shared 패키지 추출 (types, lib, stores)
- [ ] 어댑터 인터페이스 정의
- [ ] Web 어댑터 구현 (기존 코드 래핑)
- [ ] RN 어댑터 스텁 구현
- [ ] 웹 빌드/테스트 통과 확인 (regression 없음)
- [ ] 모바일 빌드 확인 (빈 앱 실행)

---

## Step-by-Step

### 1. Monorepo 초기화

```bash
# Root package.json
pnpm init

# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

### 2. Expo 프로젝트 생성

```bash
cd packages
npx create-expo-app mobile --template blank-typescript
```

### 3. shared 패키지 생성

```bash
mkdir -p packages/shared/{types,lib,stores,adapters}
# Copy pure files from src/
```

### 4. tsconfig 설정

```json
// tsconfig.base.json (root)
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "paths": {
      "@shared/*": ["./packages/shared/*"]
    }
  }
}
```

### 5. 어댑터 인터페이스 작성

See [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) — Adapter Pattern section

### 6. Web 기존 코드 import path 변경

```typescript
// Before
import { srs } from '../lib/srs'
// After
import { srs } from '@shared/lib/srs'
```

---

## Verification Checklist

- [ ] `pnpm install` — 모든 패키지 의존성 설치
- [ ] `pnpm --filter web build` — 웹 빌드 성공
- [ ] `pnpm --filter web test` — 기존 테스트 전부 통과
- [ ] `pnpm --filter mobile start` — Expo 앱 실행 (빈 화면)
- [ ] shared 패키지에서 import 가능 확인

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Import path 변경으로 웹 깨짐 | High | tsconfig paths alias로 점진적 전환 |
| Expo + pnpm 호환 이슈 | Medium | `.npmrc` 에 `node-linker=hoisted` 설정 |
| 순환 의존성 | Medium | shared → web/mobile 단방향만 허용 |
