# Phase 3: Import/Export + TTS + Storage — ✅ 완료

> 데이터 Import/Export, Supabase Storage, TTS 프로필, Python Bulk Import

## 구현 완료 항목

- 테스트 인프라 (Vitest + Testing Library) — 47 테스트
- JSON/CSV Export/Import 순수 함수 — `import-export.ts`
- Storage 헬퍼 (업로드/삭제/검증) — `storage.ts`
- TTS 프로필 연동 (speakWithProfile, getCardAudioUrl) — `tts.ts`
- ImportModal (드래그&드롭, CSV 매핑, 미리보기, 배치 삽입)
- ExportModal (JSON/CSV, BOM 포함)
- CardFormModal 이미지/오디오 실제 업로드
- DeckDetailPage Import/Export 버튼
- StudySessionPage TTS 프로필 + 스피커 버튼
- Python Bulk Import CLI

## 테스트 현황

```
src/lib/__tests__/import-export.test.ts  — 14 tests ✅
src/lib/__tests__/storage.test.ts        — 14 tests ✅
src/lib/__tests__/srs.test.ts            — 13 tests ✅
src/lib/__tests__/tts.test.ts            —  6 tests ✅
────────────────────────────────────────────────────
Total                                    — 47 tests ✅
```

## 주요 파일

```
src/lib/import-export.ts
src/lib/storage.ts
src/lib/tts.ts (수정)
src/components/import-export/ImportModal.tsx
src/components/import-export/ExportModal.tsx
src/components/card/CardFormModal.tsx (수정)
src/pages/DeckDetailPage.tsx (수정)
src/pages/StudySessionPage.tsx (수정)
scripts/bulk_import.py
scripts/requirements.txt
```
