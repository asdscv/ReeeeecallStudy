# 10. 국제화 (i18n) — 8로케일 × 2플랫폼

> 지원 로케일: **en · ko · zh · ja · vi · th · id · es** (8개, `en` 이 참조이자 fallback).
> 문자열은 웹 22 네임스페이스 × 8 = 176 파일, 모바일 18 × 8 = 144 파일, 총 320 파일.
> **새 문자열 하나를 양 플랫폼에 넣으면 로케일 JSON 16개를 만진다.**
>
> 게이트는 "키가 있는가"에 강하고 **"값이 옳은가"에는 거의 무방비**다. 이 비대칭이 이 문서의 전부다.

## 목차
- [1. 규칙](#1-규칙)
- [2. 게이트가 잡는 것 / 못 잡는 것](#2-게이트가-잡는-것--못-잡는-것)
- [3. 숫자와 날짜 — Hermes 에는 ICU 가 없다](#3-숫자와-날짜--hermes-에는-icu-가-없다)
- [4. 복수형](#4-복수형)
- [5. DB 에서 오는 문자열](#5-db-에서-오는-문자열)
- [6. 새 문자열/네임스페이스 추가 절차](#6-새-문자열네임스페이스-추가-절차)
- [7. 함정](#7-함정)

---

## 1. 규칙

| 규칙 | 게이트 |
|---|---|
| 사용자에게 보이는 문자열은 **8로케일 × 웹/모바일 두 벌 = 16 번들 전부**에 넣는다 | `translation-keys.test.ts` · `i18n.test.ts` |
| `en` 에 있는 키는 나머지 7개에 전부 있어야 한다 | `translation-keys.test.ts` (웹) · `i18n-key-usage.test.ts:168` (모바일, **양방향**) |
| 코드가 부르는 정적 `t('ns:key')` 는 로케일에 실제로 존재해야 한다. `defaultValue` 폴백에 기대지 않는다 | `i18n-key-usage.test.ts` |
| 네임스페이스는 `useTranslation('ns')` 로 고정하고, 교차 참조는 `'ns:key'` 접두 형식 | 스캐너가 별칭·`{ ns }` 옵션을 해석 |
| **계산으로 만드는 키**(`t(\`verdict.${x}\`)`, `errorKey(code)`)는 열거형/시드 행에서 목록을 뽑아 **따로** 검사한다 | `quiz-feedback-labels.test.ts` · `i18n.test.ts` Test 6 |
| 영어 번들에 한국어를 남기지 않는다 | ⚠️ `quiz.json` 한 파일에만 |
| 모바일에서 `Intl`/`toLocaleString`/`toLocaleDateString` 을 쓰지 않는다 | `i18n.test.ts` Test 5 (포매터 등록만) |
| `{{count}}` 는 복수형 선택 예약어다. 단순 숫자는 `cards`/`decks`/`n`/`y` 등 다른 이름을 쓴다 | `quiz-mistakes-i18n.test.ts`(quiz.json 한정) |
| 연도는 `{{y}}` 로 — `{{y, number}}` 는 2025 를 "2,025" 로 만든다 | 위와 동일 |

## 2. 게이트가 잡는 것 / 못 잡는 것

**잡는다**: 키 누락 · 네임스페이스 파일 집합 불일치 · 정적 `t()` 키 부재 · 계산 키 계열 부재 · `_one`/`_other` 누락 · 포맷 스펙에 Intl-free 오버라이드 없음 · 모바일 `ns[]` ↔ `resources` 불일치.

**못 잡는다 (그리고 실제로 새어나갔다)**
| 구멍 | 실제 피해 |
|---|---|
| **키는 있는데 값이 영어 그대로** | ja 로케일에 en 과 바이트 동일한 문자열이 웹 474개·모바일 211개 배포 중 (ko 는 번역돼 있는데 ja 만 영어 그대로인 것만 세도 웹 402·모바일 182) |
| **영어 번들 안의 한국어** | 영어 삭제 확인문 한가운데 "오답 노트" — *"지금까지의 어떤 테스트도 이걸 볼 수 없었습니다"* |
| **8개 로케일에서 일괄 누락** | parity 는 초록. 업적 62개 중 44개가 `decks 1`, `time 1800` 같은 raw id 로 8개 언어 전부에 나갔다 |
| **보간 인자 누락** | `t('common:units.decksCount','개')` 를 count 없이 불러 화면에 `NaN decks` (현재 1건 실재) |
| **웹 orphan 키**(en 에 없는 키) | 웹은 단방향만 검사 — 현재 6건 |

> **그러므로 문자열을 추가·수정했으면 게이트만 믿지 말고 화면을 본다.**
> 모바일은 시뮬레이터로, 웹은 언어를 바꿔가며. → [`../12_MOBILE`](../12_MOBILE/README.md)

## 3. 숫자와 날짜 — Hermes 에는 ICU 가 없다

React Native 의 Hermes 는 **full ICU 없이 빌드될 수 있다.** 그러면 `Intl` 이 조용히 다른 값을 낸다:
천단위 구분자가 사라지고(지갑에 `$1000000.00` 이 나갔다), 날짜가 미국식이 된다(한국어 폰에서 `8/15/2026`).
**에러도 경고도 없고, 개발 기기(대개 full-ICU)에서는 절대 재현되지 않는다.**

| 하려는 것 | 방법 |
|---|---|
| 숫자 | 로케일 문자열에 `{{x, number}}`(정수) / `{{x, decimal}}`(소수)를 쓰고, 포매터는 `packages/shared/lib/format-number.ts` 의 **Intl-free 구현**을 등록. 모바일은 `formatCount`/`formatDecimal` 을 `number`·`decimal` 두 스펙에 등록하지만(`packages/mobile/src/i18n/index.ts:237,240`) 웹은 `decimal` 만 등록한다(`packages/web/src/i18n/index.ts:66`) — **웹의 `{{x, number}}` 는 i18next 내장 Intl 포매터를 탄다** |
| 날짜 | `calendarParts()` 로 y/m/d 부품만 만들고 **순서는 로케일 문자열**(`history.dateThisYear` / `history.dateWithYear`)이 정한다 |
| 금지 | `toLocaleString` · `toLocaleDateString` · `new Intl.*` (모바일 코드에서) |

**잔여 부채**: 모바일에 `toLocaleDateString`/`toLocaleString` 직접 호출이 **10곳(파일 9개)** 남아 있다
(`SettingsScreen`·`DeckDetailScreen`·`MarketplaceDetailScreen`·`TemplatesListScreen`·`StudySetupScreen`×2·`VersionHistoryTab`·`WalletSummary`·`PaymentHistory`·`SessionDetailScreen`). 손대는 김에 고친다.

## 4. 복수형

- `{{count}}` 를 쓰는 키는 굴절 언어(en, es)에 **`_one` 과 `_other` 를 둘 다** 넣는다.
- `{{count}}` 만 넣는다고 복수형이 되지 않는다 — 접미사 없는 bare key 는 모든 count 에서 그대로 쓰인다. 그래서 대시보드가 `1 days`, 목표 목록이 `1 decks` 로 실기기에 나갔다.
- 기존 부채 106건은 `packages/web/src/lib/__tests__/plural-debt.json` 에 명시돼 있다. **이 목록은 줄어들기만 한다.**

## 5. DB 에서 오는 문자열

**원칙: DB 행은 표시 문자열을 담지 않는다.** id/enum/숫자만 담고 클라이언트가 `t('<family>.' || id)` 로 렌더한다
(`achievement_definitions` 에 name 컬럼 없음, `quiz_difficulty_levels` 에 label 없음).
이유는 mig 197 헤더에 적혀 있다 — *한 행이 8개 번역을 담을 수 없고, DB 에서 온 라벨은 i18n 게이트를 우회한다.*

**현재 세 방식이 공존한다**(알고 쓴다):
| 방식 | 예 | 문제 |
|---|---|---|
| A. 행은 id 만, 문자열은 로케일 파일 | `achievement_definitions`, `quiz_difficulty_levels` | **테스트가 DB 를 못 읽는다.** `achievement_definitions` 는 id 62개가 `quiz-mistakes-i18n.test.ts` 에 손으로 고정돼 있어, 행을 추가하고 목록을 안 고치면 아무것도 실패하지 않는다 (`quiz_difficulty_levels` 는 `quiz-feedback-labels.test.ts` 가 mig 197 의 INSERT 를 파싱하므로 예외) |
| B. 행 자체가 locale 을 가짐 | `contents` (slug+locale UNIQUE) | hreflang 쌍 구성에 적합 |
| C. import 시점에 번역해 텍스트로 굽기 | `packages/official-decks/.../DeckMetadataI18n.ts` | 학습자가 언어를 바꿔도 덱 이름은 안 바뀐다. 보간 문법도 `{n}` 로 다르다 |

**새 기능은 A 를 쓴다.** 그리고 A 를 쓸 때는 **id 목록을 검사하는 테스트를 같이 갱신**한다.

## 6. 새 문자열/네임스페이스 추가 절차

**문자열 1개(양 플랫폼)**
1. `packages/web/public/locales/<8개>/<ns>.json`
2. `packages/mobile/src/i18n/locales/<8개>/<ns>.json`
3. 복수형이 걸리면 en/es 에 `_one`/`_other`
4. 계산 키 계열이면 `quiz-feedback-labels.test.ts` 또는 `i18n.test.ts` 의 FAMILIES 표에 추가

**네임스페이스 1개**
- 웹: `packages/web/src/i18n/index.ts` 의 `ns[]` 1줄 + JSON 8개
- 모바일: `packages/mobile/src/i18n/index.ts` 에 **require 8줄**(동적 경로 불가) + `ns[]` + `i18n.test.ts:17` `NAMESPACES` + JSON 8개

**로케일 1개(현재 8개 고정)**: 지원 로케일 목록이 **최소 18곳에 따로 적혀 있다**(부채 D7) — `locale-utils` 2벌, `seo-config` 2벌, `content-seo` LOCALE_TO_LANGUAGE 2벌, i18n init 2벌(웹 `supportedLngs` / 모바일 `resources` 키), `SettingsPage` 인라인 배열, 모바일 `SettingsScreen` LANGUAGES, `i18n.test.ts`, `worker-modules/locale-policy.js`, `worker-modules/seo/constants.js`, `worker-modules/prompt-builder.js`, `shared/lib/marketplace.ts` LEARNING_LANGUAGES, `ai-quiz-prompts.ts` LANGUAGE_NAMES, `official-decks/LanguageCode.ts`, `official-decks/DeckMetadataI18n.ts`. **추가 전에 이 18곳을 먼저 단일화한다.**

## 7. 함정

- **`ns[]` 에 선언했는데 모바일 `resources` 에 require 를 빠뜨리면** i18next 가 키 이름을 그대로 렌더한다. 로케일 파일은 완벽했으므로 Test 1~6 이 전부 통과했고, learning 화면 3개가 `insights.title` 같은 문자열을 **프로덕션 OTA 로** 배포했다. Test 7 이 그 방향을 하드 실패로 잠갔다.
- **웹 `ns[]` 는 preload 목록일 뿐 강제력이 없다.** `quiz` 는 `ns[]` 에 없는데 HttpBackend lazy 로드로 우연히 동작 중이다.
- **DB `contents.locale`/`profiles.locale` CHECK 제약이 `es` 를 허용하지 않는다.** mig 041 이 넣었는데 mig 044 가 제약을 다시 만들면서 빠뜨렸다. 앱은 스페인어 UI 를 배포하고 있다.
- **언어 선택이 서버에 저장되지 않는다.** `profiles.locale` 컬럼은 있지만 두 앱 모두 읽지도 쓰지도 않고, 리마인더 발송(mig 067)만 그 값을 읽는다 → **사용자가 고른 언어와 리마인더 언어가 영원히 다를 수 있다.**
- **웹과 모바일 번역이 별개 사본이고 두 벌 사이 parity 게이트가 사실상 없다.** 공통 16 네임스페이스 중 `quiz.json` 만 키가 완전히 같다.
- **인라인 `defaultValue` 에 한국어를 넣지 않는다.** 웹에 `t('key','기본값')` 형태의 인라인 기본값이 231곳 있고, 그중 한국어는 3곳(모두 `packages/web/src/components/study/MultiDeckSelector.tsx`)이라 그 자리에 원래 무엇이 와야 하는지 코드만 봐서는 알 수 없다.

## 관련 문서
[`../02_CLIENT`](../02_CLIENT/README.md) · [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md) · [`../12_MOBILE`](../12_MOBILE/README.md)
