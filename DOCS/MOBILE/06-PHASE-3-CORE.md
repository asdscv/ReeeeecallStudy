# 06. Phase 3 — Core Features (Decks, Cards, Home)

> **Status**: Draft
> **Duration**: ~2 weeks

---

## Goals

- [ ] 홈/대시보드 화면
- [ ] 덱 목록 (FlatList + Pull to Refresh)
- [ ] 덱 상세 (카드 목록 + 학습 시작 버튼)
- [ ] 덱 생성/수정/삭제
- [ ] 카드 생성/수정/삭제
- [ ] 템플릿 선택
- [ ] 검색/필터

---

## Key Libraries

| Library | Purpose |
|---------|---------|
| `@react-navigation/native` | Navigation |
| `@react-navigation/bottom-tabs` | Bottom tab bar |
| `@react-navigation/native-stack` | Screen stack |
| `react-native-reanimated` | Animations |
| `react-native-gesture-handler` | Gestures |
| `@shopify/flash-list` | High-performance list (replaces FlatList) |

---

## Screens to Build

### DashboardScreen
- 오늘의 복습 카드 수
- 연속 학습일 (streak)
- 최근 학습한 덱 리스트
- Quick study 버튼

### DecksListScreen
- FlashList로 덱 목록 렌더링
- 덱 카드 UI (아이콘, 이름, 카드 수, 마지막 학습)
- FAB 버튼 → 덱 생성
- Pull to refresh
- 검색 바

### DeckDetailScreen
- 덱 정보 헤더 (이름, 설명, 통계)
- 카드 목록 (FlashList)
- 학습 시작 버튼 (모드 선택)
- 카드 추가 FAB
- Swipe-to-delete 카드

### DeckEditScreen / CardEditScreen
- Form 입력 (TextInput)
- 색상/아이콘 선택
- 필드 값 입력 (템플릿 기반)

---

## Data Flow

```
Screen Mount
  │
  ▼
Zustand Store Action (e.g., fetchDecks)
  │
  ▼
Supabase RPC Call
  │
  ▼
Store State Update
  │
  ▼
React Re-render (auto via Zustand selector)
```

모든 데이터 흐름은 웹과 **동일**합니다. Zustand store를 그대로 사용하므로 추가 데이터 레이어 불필요.
