# 10. Phase 7 — Store Release

> **Status**: Draft
> **Duration**: ~1 week

---

## Prerequisites

| Item | Apple (iOS) | Google (Android) |
|------|-------------|------------------|
| 개발자 계정 | Apple Developer ($99/yr) | Google Play Console ($25 one-time) |
| 앱 아이콘 | 1024x1024 PNG | 512x512 PNG |
| 스크린샷 | iPhone 6.7" + iPad 12.9" | Phone + 7" + 10" tablet |
| 개인정보 처리방침 | URL 필수 | URL 필수 |
| 앱 설명 | 4000자 | 4000자 |

---

## EAS Build & Submit

### eas.json

```json
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "...", "appleTeamId": "..." },
      "android": { "serviceAccountKeyPath": "./google-sa-key.json" }
    }
  }
}
```

### Build Commands

```bash
# Development (내부 테스트)
eas build --profile development --platform all

# Preview (TestFlight / Internal Testing)
eas build --profile preview --platform all

# Production
eas build --profile production --platform all

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

---

## Pre-Release Checklist

### Functionality
- [ ] 로그인/회원가입 동작
- [ ] 덱/카드 CRUD
- [ ] 학습 플로우 (모든 모드)
- [ ] TTS 동작
- [ ] AI 생성 동작
- [ ] 인앱 결제 테스트 (Sandbox)
- [ ] 딥링크 동작
- [ ] 푸시 알림

### Performance
- [ ] 앱 시작 시간 < 2초
- [ ] 카드 플립 60fps
- [ ] 메모리 < 100MB
- [ ] 크래시 0건 (내부 테스트 기간)

### Compliance
- [ ] 개인정보 처리방침 URL
- [ ] 이용약관 URL
- [ ] GDPR 대응 (EU 사용자)
- [ ] COPPA 미해당 선언 (13세 미만 대상 아님)
- [ ] App Tracking Transparency (iOS)

---

## App Store Review Tips

| 주의사항 | 대응 |
|---------|------|
| "로그인 필수 앱" | 데모 계정 제공 (review@reeeeecallstudy.xyz / password) |
| "인앱 결제 외 결제 유도" | 웹 결제 링크 금지 — 인앱만 사용 |
| "최소 기능" | Free tier에도 충분한 기능 필수 |
| "Guideline 4.2 — Minimum Functionality" | 웹 래퍼가 아닌 네이티브 경험 필수 |

---

## Post-Release

- [ ] Crashlytics / Sentry 모니터링
- [ ] 사용자 피드백 수집 (인앱 리뷰 프롬프트)
- [ ] ASO (App Store Optimization) — 키워드, 스크린샷 최적화
- [ ] OTA 업데이트 (EAS Update) — 스토어 심사 없이 JS 번들 업데이트
