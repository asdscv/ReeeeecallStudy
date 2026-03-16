# 03. Screen Map — 앱 화면 구조 & Navigation

> **Status**: Draft
> **Last Updated**: 2026-03-16

---

## Navigation Structure

```
RootNavigator (Stack)
│
├── AuthStack (로그인 전)
│   ├── LoginScreen
│   ├── SignUpScreen
│   └── ForgotPasswordScreen
│
├── MainTabs (로그인 후 — Bottom Tab Navigator)
│   │
│   ├── Tab: Home (홈)
│   │   └── HomeStack
│   │       ├── DashboardScreen         ← 대시보드 (학습 현황)
│   │       └── StudyHistoryScreen      ← 학습 이력
│   │
│   ├── Tab: Decks (덱)
│   │   └── DecksStack
│   │       ├── DecksListScreen         ← 덱 목록
│   │       ├── DeckDetailScreen        ← 덱 상세 (카드 목록)
│   │       ├── DeckEditScreen          ← 덱 수정
│   │       ├── CardEditScreen          ← 카드 편집
│   │       └── TemplateEditScreen      ← 템플릿 편집
│   │
│   ├── Tab: Study (학습) — Quick Action
│   │   └── StudyStack
│   │       ├── StudySetupScreen        ← 학습 설정 (모드, 범위)
│   │       ├── StudySessionScreen      ← 학습 진행 (카드 플립/스와이프)
│   │       └── StudySummaryScreen      ← 학습 결과 요약
│   │
│   ├── Tab: Marketplace (마켓)
│   │   └── MarketplaceStack
│   │       ├── MarketplaceScreen       ← 공유 덱 탐색
│   │       └── MarketplaceDetailScreen ← 덱 상세 / 다운로드
│   │
│   └── Tab: Settings (설정)
│       └── SettingsStack
│           ├── SettingsScreen          ← 메인 설정
│           ├── AIProviderScreen        ← AI 프로바이더 관리
│           ├── SubscriptionScreen      ← Pro 구독 관리
│           └── ProfileScreen           ← 프로필 편집
│
├── Modal Stack (전역 모달)
│   ├── AIGenerateModal             ← AI 자동 생성 위저드
│   ├── ImportModal                 ← CSV/JSON 가져오기
│   └── ExportModal                 ← 내보내기
│
└── Deep Link Handler
    ├── /invite/:code              → AcceptInviteScreen
    ├── /deck/:id                  → DeckDetailScreen
    └── /auth/callback             → AuthCallbackHandler
```

---

## Web Page → Mobile Screen Mapping

| Web Page | Mobile Screen | Priority | Notes |
|----------|---------------|----------|-------|
| `DashboardPage` | `DashboardScreen` | P1 | 학습 현황 카드 |
| `DecksPage` | `DecksListScreen` | P1 | FlatList |
| `DeckDetailPage` | `DeckDetailScreen` | P1 | 카드 목록 + 학습 시작 |
| `StudySetupPage` | `StudySetupScreen` | P1 | 모드 선택 |
| `StudySessionPage` | `StudySessionScreen` | P1 | 핵심 — 플립/스와이프 |
| `SettingsPage` | `SettingsScreen` | P1 | 설정 |
| `AIGeneratePage` | `AIGenerateModal` | P2 | 위저드 플로우 |
| `MarketplacePage` | `MarketplaceScreen` | P2 | 공유 덱 |
| `TemplatesPage` | (DeckDetail 내 진입) | P2 | 별도 탭 불필요 |
| `StudyHistoryPage` | `StudyHistoryScreen` | P2 | 이력 |
| `LandingPage` | Skip | - | 앱에 불필요 |
| `GuidePage` | Skip or WebView | P3 | 웹 가이드 링크 |
| `Admin pages` | Skip | - | 관리자는 웹 사용 |

---

## Screen Wireframes (Text)

### DashboardScreen (홈)
```
┌──────────────────────────────┐
│  Good morning, Luke!          │
│                               │
│  ┌─────────────────────────┐  │
│  │ Today's Review     12    │  │
│  │ [Start Review →]         │  │
│  └─────────────────────────┘  │
│                               │
│  ┌────────┐ ┌────────┐       │
│  │Streak  │ │Cards   │       │
│  │  7 days│ │  342   │       │
│  └────────┘ └────────┘       │
│                               │
│  Recent Study                 │
│  ├── 영작 오답노트    95%     │
│  ├── 중국어 발음      87%     │
│  └── 착 붙는 중국어   72%     │
└──────────────────────────────┘
```

### StudySessionScreen (핵심)
```
┌──────────────────────────────┐
│  ← Back          3 / 20      │
│                               │
│                               │
│  ┌─────────────────────────┐  │
│  │                         │  │
│  │     Apple               │  │
│  │                         │  │
│  │     (tap to flip)       │  │
│  │                         │  │
│  │     사과                 │  │
│  │     🔊                  │  │
│  │                         │  │
│  └─────────────────────────┘  │
│                               │
│  ← swipe left    swipe right →│
│  (Again)              (Good)  │
│                               │
│  [Again] [Hard] [Good] [Easy] │
└──────────────────────────────┘
```

---

## Gestures & Interactions

| Gesture | Screen | Action |
|---------|--------|--------|
| Tap card | StudySession | Flip front ↔ back |
| Swipe left | StudySession | Rate: Again (SRS) / Unknown |
| Swipe right | StudySession | Rate: Good (SRS) / Known |
| Swipe up | StudySession | Rate: Easy (SRS) |
| Swipe down | StudySession | Rate: Hard (SRS) |
| Long press card | DeckDetail | Card options (edit/delete) |
| Pull to refresh | DecksListScreen | Reload decks |
| Swipe row left | DeckDetail | Quick delete card |

---

## Deep Linking Scheme

```
reeeeecall://                    → App Home
reeeeecall://deck/{id}           → Deck Detail
reeeeecall://study/{deckId}      → Start Study
reeeeecall://invite/{code}       → Accept Invite
reeeeecall://auth/callback       → Auth Redirect

https://reeeeecallstudy.xyz/...  → Universal Link (same routes)
```
