# 07. Phase 4 — Study Session (핵심 화면)

> **Status**: Draft
> **Duration**: ~3 weeks (가장 복잡한 Phase)

---

## Goals

- [ ] 카드 플립 애니메이션 (3D rotate)
- [ ] 스와이프 평가 (left/right/up/down)
- [ ] 버튼 평가 (Again/Hard/Good/Easy)
- [ ] SRS 알고리즘 연동
- [ ] TTS 자동 읽기
- [ ] 학습 진행률 표시
- [ ] 학습 요약 화면
- [ ] 학습 모드 4종 (SRS, 순차복습, 랜덤, 순서대로)
- [ ] 벼락치기 모드

---

## Key Libraries

| Library | Purpose |
|---------|---------|
| `react-native-reanimated` | 카드 플립 3D 애니메이션 |
| `react-native-gesture-handler` | 스와이프 제스처 |
| `expo-speech` | TTS |
| `expo-haptics` | 햅틱 피드백 (스와이프/평가 시) |

---

## Card Flip Animation

```typescript
// Reanimated 3D flip
const rotateY = useSharedValue(0)

const frontStyle = useAnimatedStyle(() => ({
  transform: [{ rotateY: `${rotateY.value}deg` }],
  backfaceVisibility: 'hidden',
}))

const backStyle = useAnimatedStyle(() => ({
  transform: [{ rotateY: `${rotateY.value + 180}deg` }],
  backfaceVisibility: 'hidden',
}))

function flip() {
  rotateY.value = withTiming(
    rotateY.value === 0 ? 180 : 0,
    { duration: 300 }
  )
}
```

---

## Swipe Gesture

```typescript
const gesture = Gesture.Pan()
  .onUpdate((e) => {
    translateX.value = e.translationX
    translateY.value = e.translationY
  })
  .onEnd((e) => {
    const { translationX, translationY, velocityX } = e

    if (translationX < -SWIPE_THRESHOLD || velocityX < -VELOCITY_THRESHOLD) {
      // Swipe Left → Again / Unknown
      runOnJS(handleRate)('again')
    } else if (translationX > SWIPE_THRESHOLD || velocityX > VELOCITY_THRESHOLD) {
      // Swipe Right → Good / Known
      runOnJS(handleRate)('good')
    } else if (translationY < -SWIPE_THRESHOLD) {
      // Swipe Up → Easy
      runOnJS(handleRate)('easy')
    } else if (translationY > SWIPE_THRESHOLD) {
      // Swipe Down → Hard
      runOnJS(handleRate)('hard')
    } else {
      // Snap back
      translateX.value = withSpring(0)
      translateY.value = withSpring(0)
    }
  })
```

---

## Study Flow (Reuses Web Logic)

```
StudySetupScreen
  │ User selects mode + deck
  ▼
study-store.startSession(deckId, mode)      ← shared store
  │ Builds queue from SRS algorithm
  ▼
StudySessionScreen
  │ Displays current card
  │ User flips → sees back
  │ User rates (swipe or button)
  ▼
study-store.rateCard(rating)                ← shared store
  │ Updates SRS data, moves to next card
  │ Loop until queue empty
  ▼
StudySummaryScreen
  │ Shows results (correct %, time, cards reviewed)
  ▼
study-store.endSession()                    ← shared store
```

**모든 학습 로직은 shared store에서 처리** — 모바일에서는 UI만 새로 구현.

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Card flip animation | 60fps |
| Swipe response | < 16ms |
| TTS start | < 300ms |
| Screen transition | < 200ms |
| Memory (study session) | < 50MB |
