# 웹 검색 키워드 루프 — 하루 1편, 실측 검색어로

## 0. 왜

2026-11-11 실측(프로덕션):

| 신호 | 값 |
|---|---|
| 발행된 글 | **3,304편** (slug 1,196개) |
| 최근 30일 발행 | 279편 — 하루 약 9편 |
| 사람이 글을 연 횟수(`content_views`, 2026-02 이후 누적) | **117회** |
| 그중 스크롤 기록 있음 | 45회 (대부분 끝까지 읽음) |

글은 쌓이는데 아무도 안 들어온다. 색인은 된다(2026-06 GSC 색인 685건) — 문제는
**AI 가 상상한 주제로 하루 여러 편** 찍는 방식이다. 아무도 그 말로 검색하지 않고,
구글은 대량 생성 글을 낮게 본다.

참고한 사례(Starter Story, iOS 앱 Vaultaire, 월 $41K): 앱스토어 1등은 15년 된 거인들 몫이라
포기하고, 거인들이 방치한 **웹 검색**에서 같은 손님을 데려온다. 매일 아침 서치콘솔에서
**노출은 많은데 클릭이 0인 검색어**를 찾아 그 검색어 하나만을 위한 가이드를 **하루 딱 1편** 쓰고,
글에서 사람들이 나가는 자리마다 앱 다운로드 버튼을 둔다. 3개월 클릭 23K · 노출 2.43M ·
웹 전환율 약 10%.

## 1. 무엇이 바뀌었나

| 전 | 후 |
|---|---|
| 하루 5주제 × en/ko = 10편 | **하루 1주제 × en/ko = 2편** (`PIPELINE_DEFAULTS.topicsPerRun = 1`) |
| 주제 = AI 가 상상 | 주제 = **서치콘솔 실측 검색어** (없거나 실패하면 종전 AI 주제로) |
| 글 끝에만 CTA | **첫 답 직후 · 마무리 직전**에 앱 다운로드 블록 + 끝 CTA |

**키워드 플래너** (`worker-modules/keyword-planner.js`, 매일 06:00 UTC 크론):

1. `search-console.js` — 최근 확정 180일(오늘-3일까지) 검색어별 노출·클릭·순위.
2. 코드가 숫자로 거른다: 최근 180일 노출 ≥ 1 · 클릭 0 · 평균순위 ≥ 8 · 이미 쓴 검색어 제외
   (`contents.target_query`, 마이그레이션 284) → 노출 순 상위 25개.
3. **Jev 1회 호출**로 후보마다 판정: 학습자 질문인가(Noul) · 다른 제품 이름인가(Noul) ·
   언어(Choice: en/ko/기타) · 글 형식(Choice: 가이드/비교/설명).
4. 코드가 고른다: 적합도 ≥ 0.6 · 브랜드 < 0.5 · 생성 언어(en/ko) → **노출 × 적합도** 최대 1개.
5. 프롬프트가 그 검색어를 제목·meta_title·첫 문단·H2 에 그대로 넣고, 첫 문단에서 40단어 안에 답하게 한다.
   다른 언어판은 그 언어 화자가 실제로 칠 표현으로 쓴다. 비교 형식이라도 **다른 앱·회사 이름은 쓰지 않는다**
   (방법·시험·접근법끼리 비교).

Jev 실측(jev-1.14.0, 후보 12개, 267ms, 입력 5,406 토큰):

```
toeic part 5 grammar patterns   fit 0.97 brand 0.07 en    guide       ← 선택
수능 영어 단어 외우는 법          fit 0.95 brand 0.06 ko    guide
quizlet alternative free        fit 0.30 brand 0.97 en    comparison  ← 경쟁 브랜드, 제외
ielts vs toefl which is easier  fit 0.87 brand 0.20 en    comparison
học từ vựng toeic hiệu quả      fit 0.97 brand 0.14 other guide       ← vi 는 생성 안 함, 제외
jlpt n3 kanji list pdf          fit 0.52 ...                          ← PDF 다운로드 의도, 기준 미달
best anime 2026 / iphone 17 price / hide photos on iphone   fit 0.02  ← 무관
```

**이탈 지점 CTA** (`packages/shared/lib/content-drop-off.ts`): 렌더 시점에 끼우므로 **기존 3,304편 전부에 즉시** 붙는다.
웹 글 화면(`AppCtaBlock` — App Store · Google Play · 웹 시작)과 크롤러 HTML(스토어 링크) 둘 다 같은 규칙.
Google Play 링크엔 `referrer=utm_…` 을 실어 Play Console 에서 글·위치별 설치를 볼 수 있다.
클릭은 `record_analytics_event` 의 `content / app_cta_click / <answer|wrap_up>:<ios|android|web>` 로 남는다.

## 2. 켜는 법 (소유자 1회)

코드는 배포돼 있어도 아래 둘이 없으면 **종전 AI 주제로 하루 1편**만 쓴다.

1. **서비스 계정** — 아무 GCP 프로젝트에서 *Google Search Console API* 사용 설정 → 서비스 계정 만들기 →
   JSON 키 발급. 서치콘솔 → 설정 → 사용자 및 권한 → 그 서비스 계정 이메일을 **제한됨** 권한으로 추가.
2. **워커 시크릿**
   ```bash
   npx wrangler login
   npx wrangler secret put GSC_SERVICE_ACCOUNT_JSON < key.json
   npx wrangler secret put TYPESAFE_API_KEY
   ```
   속성이 도메인 속성(`sc-domain:reeeeecallstudy.xyz`)이 아니면 `GSC_SITE_URL` 도 넣는다(예: `https://reeeeecallstudy.xyz/`).

확인: 다음 크론 로그에 `Keyword planner: judged` 와 `picked`, 새 글 행에 `target_query` 가 찍힌다.

```sql
SELECT slug, locale, target_query, published_at FROM contents
WHERE target_query IS NOT NULL ORDER BY published_at DESC LIMIT 10;
```

## 3. 숫자를 다시 볼 때

- 효과는 3~4일 뒤 서치콘솔에서 그 검색어의 클릭·순위로 본다(글이 반영되는 데 그만큼 걸린다).
- 전환: `analytics_events` 의 `app_cta_click` ÷ `content_views`. 지금 분모가 117 이라 비율은 아직 의미 없다.
- 이탈 지점은 구조 기준(첫 답 직후 · 마지막 소제목 앞)이다. `content_views.scroll_depth_percent` 가
  수백 건 쌓이면 실제 이탈 분포로 다시 맞출 것.

## 4. 연동 후 실측 (2026-11-11)

서치콘솔 연결: 서비스 계정 `gsc-keyword-planner@reeeeecallstudy.iam.gserviceaccount.com`(GCP 프로젝트 `reeeeecallstudy`,
Search Console API 사용 설정) → 서치콘솔 `sc-domain:reeeeecallstudy.xyz` 에 «제한적» 사용자로 추가(소유자 asdscv@gmail.com).

**노출 자체가 거의 없다.** 2026-03~11 합계 노출 **208회 · 클릭 2회**, 10월 노출 5회. 글 약 3,300편 중
한 번이라도 노출된 페이지 **117개**, 검색어 22개(평균순위 19~85). 영상 사례(키워드 하나에 노출 16,000회)와
출발점이 다르다 — 28일·노출 20회 기준이면 후보가 0개라 계속 AI 주제로 빠졌다.

그래서 기준을 이 사이트 규모로 낮췄다: **180일 · 노출 1회 이상**, 동점이면 순위가 높은(1페이지에 가까운) 검색어.
실데이터 1회 실행: 후보 21개 → `jlpt n2 문법`(노출 3 · 68위 · 적합 0.93 · ko · 가이드) 선택,
다음 후보 `process diagram ielts` · `jlpt n3 문법` · `integrated writing` · `toeic part 6`.
후보 21개를 다 쓰면(약 3주) 새로 노출이 생길 때까지 AI 주제로 돌아간다. 트래픽이 늘면 기준을 다시 올릴 것.
