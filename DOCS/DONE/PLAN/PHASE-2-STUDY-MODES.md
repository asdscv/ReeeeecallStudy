# Phase 2: Study Modes — ✅ 완료

> SRS, 순차복습, 랜덤, 순서대로 학습 모드 4종

## 구현 완료 항목

- SRS 알고리즘 (SM-2 변형) — `srs.ts`
- 학습 세션 관리 — `study-store.ts`
- 학습 모드 4종 (SRS, sequential_review, random, sequential)
- 학습 모드 선택 UI — `StudySetupPage.tsx`
- 학습 세션 UI — `StudySessionPage.tsx`
- 카드 렌더링 (템플릿 레이아웃 기반) — `StudyCard.tsx`
- SRS 평가 버튼 (Again/Hard/Good/Easy) — `SrsRatingButtons.tsx`
- 일반 평가 버튼 — `SimpleRatingButtons.tsx`
- 프로그레스 바 — `StudyProgressBar.tsx`
- 학습 요약 — `StudySummary.tsx`
- 키보드 단축키 — `useKeyboardShortcuts.ts`
- TTS 기본 (Web Speech API) — `tts.ts`

## 주요 파일

```
src/lib/srs.ts
src/lib/tts.ts
src/stores/study-store.ts
src/hooks/useKeyboardShortcuts.ts
src/pages/StudySetupPage.tsx
src/pages/StudySessionPage.tsx
src/components/study/StudyCard.tsx
src/components/study/SrsRatingButtons.tsx
src/components/study/SimpleRatingButtons.tsx
src/components/study/StudyProgressBar.tsx
src/components/study/StudySummary.tsx
```
