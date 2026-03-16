# 08. Phase 5 — Additional Features

> **Status**: Draft
> **Duration**: ~2 weeks

---

## Goals

- [ ] AI 자동 생성 (위저드 플로우)
- [ ] 마켓플레이스 (공유 덱 탐색/다운로드)
- [ ] 설정 화면 (프로필, 언어, TTS, AI 프로바이더)
- [ ] Import/Export (CSV/JSON)
- [ ] 학습 이력/분석
- [ ] 푸시 알림 (복습 리마인더)

---

## AI Generate (Modal Flow)

웹의 위저드 플로우를 RN 모달 스택으로 구현:

```
AIGenerateModal (Bottom Sheet or Full Screen Modal)
├── Step 1: Config (프로바이더 선택 + 주제 입력)
├── Step 2: Review Template
├── Step 3: Review Deck
├── Step 4: Review Cards
└── Step 5: Done
```

AI 프로바이더 키는 `expo-secure-store`에서 로드 (shared AIKeyVault의 RN 어댑터).

---

## Marketplace

```
MarketplaceScreen
├── 카테고리 필터 (horizontal scroll)
├── 검색 바
├── 덱 리스트 (FlashList)
│   ├── 덱 카드 (이름, 설명, 카드 수, 다운로드 수)
│   └── Tap → MarketplaceDetailScreen
│
MarketplaceDetailScreen
├── 덱 정보
├── 카드 미리보기
├── [다운로드] 버튼
└── 작성자 프로필
```

---

## Push Notifications (복습 리마인더)

```typescript
import * as Notifications from 'expo-notifications'

// Schedule daily review reminder
await Notifications.scheduleNotificationAsync({
  content: {
    title: 'Time to study!',
    body: 'You have 12 cards to review today.',
  },
  trigger: {
    hour: 9,
    minute: 0,
    repeats: true,
  },
})
```

| Library | Purpose |
|---------|---------|
| `expo-notifications` | 로컬 + 푸시 알림 |
| Supabase Edge Function | 서버 → 푸시 트리거 (선택) |

---

## Settings Screen

웹 SettingsPage와 동일한 섹션:

| Section | RN Component |
|---------|-------------|
| 프로필 | TextInput + Save |
| 언어 | RadioButton list |
| SRS 설정 | NumberInput + Save |
| 답변 방식 | Toggle (Button/Swipe) |
| TTS | Toggle + Speed slider |
| AI 프로바이더 | Provider list → SecureStore |
| Pro 구독 | RevenueCat paywall |
| 로그아웃 | Button |

---

## Import/Export

| Feature | Web | Mobile |
|---------|-----|--------|
| CSV Import | File input | `expo-document-picker` |
| JSON Import | File input | `expo-document-picker` |
| CSV Export | Blob download | `expo-sharing` |
| JSON Export | Blob download | `expo-sharing` |

```typescript
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'

// Import
const result = await DocumentPicker.getDocumentAsync({ type: 'text/csv' })
const content = await FileSystem.readAsStringAsync(result.assets[0].uri)

// Export
const filePath = FileSystem.documentDirectory + 'deck-export.csv'
await FileSystem.writeAsStringAsync(filePath, csvContent)
await Sharing.shareAsync(filePath)
```
