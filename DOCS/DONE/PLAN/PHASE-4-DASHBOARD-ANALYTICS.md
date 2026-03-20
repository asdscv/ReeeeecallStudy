# Phase 4: Dashboard Analytics — ✅ 완료

> 잔디 히트맵, 학습량 차트, 복습 예측, 덱별 통계 탭, 업로드 일자 탭

## 구현 완료 항목

- 통계 순수 함수 (getForecastReviews, getHeatmapData, getDailyStudyCounts, getStreakDays, getMasteryRate, groupCardsByDate, calculateDeckStats)
- 통계 Supabase 쿼리 (fetchStudyLogs, fetchDeckStudyLogs)
- 대시보드 요약 카드 4종 (전체 카드, 오늘 복습, 연속 학습, 숙달률)
- 학습 잔디 히트맵 (react-calendar-heatmap)
- 복습 예측 바 차트 7일 (recharts)
- 일별 학습량 바 차트 30일 (recharts)
- 덱 현황 카드 + 학습 바로가기
- DashboardPage 풀 리팩토링
- DeckDetailPage 탭 시스템 (카드 목록 / 업로드 일자 / 통계)
- 덱별 상태 분포 파이 차트 + 일별 학습 차트

## 테스트 현황

```
src/lib/__tests__/stats.test.ts         — 19 tests ✅
src/lib/__tests__/import-export.test.ts — 14 tests ✅
src/lib/__tests__/storage.test.ts       — 14 tests ✅
src/lib/__tests__/srs.test.ts           — 13 tests ✅
src/lib/__tests__/tts.test.ts           —  6 tests ✅
────────────────────────────────────────────────────
Total                                   — 66 tests ✅
```

## 새로 생성 파일

| # | 파일 | 역할 |
|---|------|------|
| 1 | `src/lib/stats.ts` | 통계 쿼리 + 순수 함수 |
| 2 | `src/lib/__tests__/stats.test.ts` | 통계 단위 테스트 |
| 3 | `src/components/dashboard/StatsSummaryCards.tsx` | 요약 카드 4종 |
| 4 | `src/components/dashboard/StudyHeatmap.tsx` | 잔디 히트맵 |
| 5 | `src/components/dashboard/ForecastWidget.tsx` | 복습 예측 바 차트 |
| 6 | `src/components/dashboard/DailyStudyChart.tsx` | 일별 학습량 |
| 7 | `src/components/dashboard/RecentDecks.tsx` | 최근 덱 바로가기 |
| 8 | `src/components/deck/UploadDateTab.tsx` | 업로드 일자 탭 |
| 9 | `src/components/deck/DeckStatsTab.tsx` | 덱 통계 탭 |

## 수정 파일

| # | 파일 | 변경 |
|---|------|------|
| 1 | `src/pages/DashboardPage.tsx` | 풀 대시보드 리팩토링 |
| 2 | `src/pages/DeckDetailPage.tsx` | 탭 시스템 추가 |
