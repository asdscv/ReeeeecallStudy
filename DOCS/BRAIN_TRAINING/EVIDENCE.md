# 두뇌 트레이닝 — 근거 대조표와 설계 명세

> 내부 문서. 앱·스토어·광고의 모든 건강 관련 문장은 여기 출처가 있어야 한다(표시광고법 제5조: 요청 시 15일 안에 실증 자료 제출).
> 2026-11-12 조사: 1차 출처 탐색 3갈래 → 갈래마다 독립 교차검증 → 설계안 → 임상방법론·소비자보호 관점 비판 검토. 아래 «적용한 비판»은 출시본에 반영된 것이다.

## 출시본에 들어간 주장과 출처

| 화면 문장(요지) | 출처 |
|---|---|
| 빠른 눈은 ACTIVE·IHAMS의 처리속도 훈련 «방식»을 참고했다(효과 주장 아님, 같은 프로그램 아님, 미검증) | Ball 2002; Ball 2013; Wolinsky 2013; Edwards 2018; Owsley 2013 |
| 노출 시간 사다리 500→17ms, 변형 사다리(주변 링·방해물·유사도·같음/다름) | Owsley 2013; Ball 2013; Wolinsky 2013(9단계 모핑, 방해물 최대 47) |
| 목표 정답률: 빠른 눈 80%(+0.25/−1.0), 다른 게임 85%(+0.15/−0.85, 같은 그림은 보폭만 2배 +0.30/−1.70) — 원 연구 75%에서 «제품 결정»으로 상향 | Kaernbach 1991; Levitt 1971; Wilson 2019(85%는 이론적 경험칙) |
| 순서·공간 기억: 길이마다 기회 2번, 1초에 1개 | Kessels 2000 |
| 주 3회 이하가 더 나았다(연구 간 비교, 불확실), 30분 미만 근거 약함 — 오늘의 훈련 20~25분은 이보다 짧다고 명시 | Lampit 2014 |
| 기본 과정 10세션, 복습 과정 약 11·35개월 | Ball 2002; Ball 2013 |
| 훈련 과제는 늘지만 다른 능력·일상 전이 근거는 약하다 | Simons 2016; Owen 2010; Melby-Lervåg 2016 |
| 처리속도: 훈련과 거의 같은 검사에서 향상, 10년 뒤 일부 차이, 기억으로 전이 없음, 원 연구 10~12시간 vs 앱 약 4시간 | Ball 2002; Rebok 2014; Edwards 2018 |
| 코크란: 효과 작고 1년 유지 근거 없음 | Gates 2020 |
| 인지훈련이 치매를 예방한다는 것은 확인되지 않았다 | WHO 2026(5년 치매 발생 HR 1.00); Gates 2019; Coe 2026·Dickens 2026(논쟁) |
| 만 60세 이상 보건소(치매안심센터) 무료 인지 선별검사(ko만) | 보건복지부 치매관리 사업 안내 |

## 출시 게이트(법무 검토 또는 식약처 「의료기기 해당 여부 질의」 회신 전에는 싣지 않음)

- WHO 2026 지침 문단, Lancet 2024 위원회 수치, 보건복지부 «치매예방수칙 3·3·3» 카드, «두뇌/건강한 생활 습관» 카드
- ACTIVE 장기 치매 분석(HR 0.71 / 0.75)은 어떤 경우에도 화면·스토어·푸시·광고에 쓰지 않는다
- 연구 근거 페이지와 건강 관련 스토어 문구는 ko·en만. ja·zh·es·vi·th·id는 현지 규제 검토 전까지 메뉴명·면책 문구·게임 설명만

## 금지 표현(8개 로케일 전부, UI·스토어·푸시·광고·SNS·고객 응대)

치매 예방/위험 감소/진행 지연/치료 · 경도인지장애·인지장애 개선 · 뇌 노화 방지·뇌 나이 · 기억력/집중력/처리속도 향상, 지능 향상, 인지 저하 지연 · 과학적·임상적으로 입증 · 치매 위험도·인지 수준 평가·두뇌 점수 · 일·공부·운전 능력 향상 · ADHD·뇌졸중·외상성 뇌손상·PTSD·우울증에 도움 · WHO 권장 · 다른 앱·퍼즐보다 효과적. 고정 면책 문구(«diagnose, treat, cure, or prevent»)는 예외.

## 남은 일

- 법무 검토 또는 식약처 질의 → 게이트 콘텐츠 공개 여부 결정
- 빠른 눈 진급 기준(V5–9 ≤200ms, V10+ ≤250ms)은 Edwards 2006 노인 규준 원문 확인 후 확정, 출시 후 사용자 중앙값으로 조정
- 게임별 실제 수렴 정답률 로그, 60세 이상 라운드 완료율·D7/D28 재방문 확인. 목숨 수 A/B는 효과 주장 근거로 쓰지 않는다
- 어려운 내용 개편(2026-11-13, `GAMES_DIFFICULTY_PLAN.md`)의 기준 시간·칸당 탐색 시간·판 종류 배율·나눠 보여 주기 길이는 **모델 값**이다. 출시 뒤 종류별 반응시간 중앙값과 수렴 정답률로 다시 맞춘다(§4.5). 시험은 문제 내용의 성질을 확인할 뿐 사람을 잰 것이 아니다
- 개편 문구의 es·id·ja·th·vi·zh 번역은 원어민 검수 전(§6.2)
- PACT 시험(NCT03848312, 2028 예정) 결과 전에는 치매 관련 주장 없음

---

## 부록 A. 설계 명세(비판 검토 전 원안)

# 두뇌 트레이닝 재설계 설계 명세 (근거 기반 v2)

ReeeeecallStudy: web React, Expo iOS/Android, 8개 로케일

이 문서는 검증 통과(verified)·정정(corrected) 판정을 받은 연구 결과만 사용했다. 정정된 항목은 정정된 내용을 따랐다. 연구 근거가 아니라 제품 판단으로 정한 수치에는 **[제품 결정]** 표시를 달았다. 이 값들은 출시 후 사용 기록을 보고 조정한다.

---

## 1. 근거 요약

| # | 등급 | 내용 |
|---|---|---|
| 1 | **강함 (방법론)** | 적응형 계단법(staircase)의 수렴점은 수식으로 정해진다. 맞을 때 오르는 폭(S_up)과 틀릴 때 내리는 폭(S_down)이 S_up·p = S_down·(1−p) 를 만족하는 정답률 p에서 멈춘다 [Kaernbach 1991; Levitt 1971]. 지금 규칙(정답 +0.3, 빠른 정답 +0.45, 오답 −0.8)은 72.7%에 수렴하고, 빠른 사용자는 64%까지 떨어진다. 목표 정답률이 사용자 속도에 따라 몰래 바뀐다는 뜻이다. |
| 2 | **보통** | 훈련한 과제 자체의 실력은 확실히 는다. 비슷한 과제로 옮겨가는 효과는 작고, 다른 능력이나 일상으로 옮겨가는 효과는 거의 없다 [Simons 2016; Owen 2010; NASEM 2017]. 작업기억 훈련(Flash Grid·Sequence 계열)은 위약 효과와 출판 편향을 통제하면 다른 능력으로 옮겨가는 효과가 0이다 [Melby-Lervåg 2016]. |
| 3 | **보통→약함** | 건강한 노인에게 컴퓨터 인지훈련의 전체 효과는 작다(g=0.22). 영역별로는 처리속도 g=0.31이 가장 크다 [Lampit 2014]. 코크란 리뷰는 훈련 직후 전반 인지 SMD −0.31(CCT 쪽 유리)을 보고했지만 12개월 뒤에는 유지되지 않았고, 근거 확실성은 낮음이다 [Gates 2020]. |
| 4 | **보통 (훈련한 능력 기준)** | 처리속도(UFOV형) 훈련은 다른 훈련보다 훈련한 능력의 향상이 크고 오래간다. ACTIVE에서 훈련 직후 신뢰할 만한 향상을 보인 비율은 처리속도 87%, 추론 74%, 기억 26%였다 [Ball 2002]. 10년 뒤에도 처리속도 효과크기 0.66이 남았고, 복습(부스터) 훈련이 0.62를 더했다 [Rebok 2014]. 메타분석에서 적응형은 d=0.89였다. 처리속도·주의 측정치로는 약간 옮겨갔고(d=0.22·0.14), 기억·실행기능·반응시간으로는 옮겨가지 않았다 [Edwards 2018]. 활성 대조군을 둔 IHAMS에서는 집에서 혼자 한 집단도 향상됐다 [Wolinsky 2013]. |
| 5 | **약함·논쟁 중** | 치매 결과. ACTIVE 10년 분석에서 처리속도 훈련은 HR 0.71(0.50–0.998, P=.049)이었다. 단, 치매를 임상 진단이 아니라 알고리즘으로 정의했다 [Edwards 2017]. 20년 메디케어 청구 분석에서는 무작위 배정 그대로 비교(ITT)한 결과가 처리속도 포함 모든 군에서 유의하지 않았다(처리속도 0.87, 0.72–1.05). "처리속도 + 부스터" 하위집단만 HR 0.75(0.59–0.95)였는데, 이 분석은 사전등록에 빠져 있었다 [Coe 2026]. 다중비교를 보정하면 모두 유의하지 않다는 재분석도 있다 [Dickens 2026]. 5년 시점에는 효과가 없었다 [Unverzagt 2012]. |
| 6 | **근거 없음** | 경도인지장애(MCI)에서 CCT가 치매 전환을 늦춘다는 시험은 없다. 치매 발생을 보고한 시험이 하나도 없다 [Gates 2019]. MCI 환자에게 상용 게임은 크로스워드보다 주요 지표가 나빴다(ADAS-Cog 차이 −1.44, P=0.04, 크로스워드 쪽 유리) [Devanand 2022]. |
| 7 | **낮음 (국제 지침)** | WHO 2026은 인지훈련을 "제공할 수 있다"(조건부, 확실성 낮음), 인지 자극을 "권장할 수 있다"(조건부, 매우 낮음)로 정했다. 5년 시점 치매 발생은 HR 1.00이고, 최적의 종류·빈도·강도·기간은 "근거 불충분"이라고 적었다 [WHO 2026]. |
| 8 | **보통 (연구 간 비교라 혼입 가능)** | 용량과 형식이 효과를 가른다. 주 3회 이하가 효과적이었고, 3회 초과는 효과 근거가 없었다. 집에서 혼자 하는 형식은 g=0.09로 유의하지 않았고, 집단 형식은 g=0.29였다. 30분 미만 세션은 근거가 약하다 [Lampit 2014]. 참여율 60% 이상 또는 순응도 80% 이상일 때만 효과가 유의했다 [Li 2024]. FINGER에서 전 세션을 완료한 사람은 12%였다 [Turunen 2019]. |
| 9 | **보통** | 적응형 난이도가 효과의 핵심이다. 쉬운 수준에 고정하는 것보다 향상이 컸다 [Brehmer 2012; Edwards 2018]. |
| 10 | **보통~높음 (다영역)** | 다영역 개입이 확실성이 가장 높지만 효과는 미미하다(SMD 0.01–0.08) [WHO 2026]. FINGER는 운동·식단·인지훈련·혈관 관리 묶음으로 효과를 냈고, 게임 단독 효과는 분리할 수 없다 [Ngandu 2015]. POINTER는 구조화군에만 CCT가 있어 구조화와 CCT 효과를 분리할 수 없다 [Baker 2025]. 조절 가능한 위험요인 14개가 인구 수준에서 약 45%를 설명한다는 추정이 있다(청력 7%, LDL 7%) [Livingston 2024]. |
| 11 | **근거 없음** | 목숨(lives)·게임오버 규칙을 시험한 연구는 없다. 게임화는 동기를 높이지만(g=0.72) 과제를 더 힘들게 느끼게 하고(g=−0.52), 인지 효과는 없었다 [Vermeir 2020]. |

**결론.** 근거가 받쳐 주는 제품 주장은 "근거 있는 훈련 방식을 참고한, 꾸준한 두뇌 활동"까지다. 치매 관련 주장은 할 수 없다. 법적 근거는 6장에 있다.

---

## 2. 게임 구성 결정

### 2.1 기존 8개 게임

| 게임 | 결정 | 이유 | 바꿀 점 |
|---|---|---|---|
| **Odd One Out** (시각 탐색) | 유지, 속도 계열 | 처리속도·시각 탐색 | 계단법 규칙(§4) 적용. 칸 크기 하한(§5) |
| **Number Hunt** (슐테 표) | 유지, 속도 계열 | 처리속도 | 칸이 작아지는 방식으로 어렵게 하지 않는다. 폰에서는 최대 5×5. "빠름"은 본인 중앙값 기준 |
| **Flash Grid** (공간 작업기억) | **변경** | 작업기억은 다른 능력으로 옮겨가지 않음 [Melby-Lervåg 2016] | Corsi 규칙(§4.3). 이름표는 "공간 기억 연습". 불 켜지는 간격은 1초에 1개 이하 |
| **Sequence** (Corsi형) | **변경** | 위와 같음 | Corsi 규칙: 길이마다 2번 기회, 1초에 1개 제시 [Kessels 2000] |
| **Match Pairs** | 유지, 다양성용으로 강등 | 특정 근거 없음. FINGER의 관계 기억 과제와 비슷할 뿐 | 오늘의 훈련 기본 순환에서 빈도를 낮춘다 |
| **Color Word** (스트룹) | 유지, 다양성용으로 강등 | 실행기능·주의 영역은 유의하지 않음 [Lampit 2014] | 색각이상에 안전한 팔레트 + 모양 모드. 시간 여유 설정 |
| **Quick Math** | 유지, 다양성용 | 직접 근거 없음 | 시간 여유 ×1.5 / ×2 / 끔 |
| **Number Pattern** (수열) | 유지 | ACTIVE 추론 훈련과 같은 계열. 추론 능력 10년 효과크기 0.23 [Rebok 2014]. 치매 효과는 없음 | "치매" 관련 이름표를 붙이지 않는다 |

### 2.2 새 게임

1. **「빠른 눈」 / Quick Eye (대표 게임, 필수)**: UFOV형 처리속도·분할주의 과제. 사양은 §2.3. 상표인 UFOV, Double Decision, BrainHQ, Road Tour는 UI와 마케팅에 쓰지 않는다.
2. **「규칙 바꾸기」 / Switch (2단계, 선택)**: 과제 전환(set-shifting) 게임. FINGER 과제 목록 중 우리에게 가장 크게 빠진 영역이다 [Ngandu 2015]. 예시: 숫자 카드가 위에 나오면 홀/짝, 아래에 나오면 5보다 큰지/작은지로 답한다. 효과 주장은 하지 않는다.

### 2.3 「빠른 눈」 상세 사양

출처는 Ball 2002, Ball 2013, Owsley 2013, Wolinsky 2013, Edwards 2018이다. ACTIVE 강사 매뉴얼의 정확한 ms 사다리, 계단 폭, 마스크 길이는 공개된 1차 자료에서 찾지 못했다. 그래서 아래 값 일부는 [제품 결정]이다.

**화면 배치**
- 중앙에 고정 상자를 둔다. 정사각형 112dp, 고대비 흰 테두리 2dp, 배경은 중간 회색이다.
- 중앙 자극은 상자 안 아이콘 1개, 72dp. 두 종류 중 하나를 보여 준다(원작은 승용차/트럭). 문화적으로 중립적인 그림을 쓴다. 예: 컵 vs 주전자, 또는 단순 도형 쌍. 두 아이콘의 유사도를 1~9단계로 바꿀 수 있게 만든다. IHAMS가 9단계 모핑을 썼다.
- 주변 자리는 8방향(0°, 45°, …, 315°) × 3개 링(안·중간·바깥)이다. 반경 R = min(화면 너비, 높이)/2 − 40dp로 하고, 링은 R의 0.4 / 0.7 / 1.0에 둔다.
- 방해물을 넣으면 각 링에 16칸(8방향 + 그 사이 8개)씩, 모두 48칸을 쓴다. 표적 1개, 방해물 최대 47개다. UFOV 3번 하위검사와 IHAMS 최대치와 같은 수다.
- 표적은 별 모양 아이콘 56dp. 모양으로 구분되게 하고, 색만으로 구분하게 하지 않는다. 방해물은 같은 크기·밝기의 삼각형이다(UFOV 방식). 표적은 8개 방사선 위 자리에만 나온다.
- 폰에서는 가로 모드를 권장하고 태블릿을 우선한다. 폰은 시각 각도가 원 시험의 10~14°에 못 미친다(폰 바깥 링은 약 5° 안팎). 폰 버전은 검증되지 않았다고 내부 문서에 적는다 [Owsley 2013].

**한 시행의 순서**
1. 고정 상자만 보여 준다: 500ms [제품 결정]
2. 자극: 중앙 아이콘(+ 주변 표적 + 방해물)을 **N프레임** 보여 준다
3. 마스크: 화면 전체에 무작위 패턴을 깐다. 평균 밝기는 자극과 같게 맞춘다. 길이 500ms [제품 결정. 2차 자료에 나온 값이고 1차 자료로 확인하지 못했다]
4. 응답 ①: 중앙 아이콘이 무엇이었는지 고른다(큰 버튼 2개, 각 ≥ 72dp). **시간 제한 없음**
5. 응답 ②(2단계 이상): 표적이 있던 방사선 위치를 고른다(8개 자리 버튼, 각 ≥ 56dp). **시간 제한 없음**
6. 피드백 600ms: ✓/✗ 표시, 정답 위치 강조
7. 다음 시행까지 간격 ≥ 1,000ms. WCAG 2.3.1(1초 3회 이하 깜박임)을 지키기 위해서다.

응답에 시간 제한을 두지 않는다. "속도"는 노출 시간으로만 잰다. 그래서 나이 때문에 늦은 선택 반응 시간 [Der 2006]이 감점되지 않는다.

**정답 판정**
- 1단계는 중앙만 맞으면 정답이다.
- 2단계부터는 중앙과 위치가 **둘 다** 맞아야 정답이다.

**노출 시간 사다리** (60Hz 프레임 기준, 13칸, 로그 간격에 가깝게)

| 레벨 L | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 프레임 | 30 | 24 | 20 | 16 | 13 | 10 | 8 | 6 | 5 | 4 | 3 | 2 | 1 |
| ms | 500 | 400 | 333 | 267 | 217 | 167 | 133 | 100 | 83 | 67 | 50 | 33 | 17 |

- **천장**(가장 쉬움)은 500ms(L=0), **바닥**(가장 어려움)은 17ms(L=12)다. 범위는 UFOV PC판과 같다 [Owsley 2013].
- 사다리는 **ms로 정의**하고 실행할 때 프레임 수 = round(ms / 측정한 프레임 길이)로 바꾼다. 최소는 1프레임이다. 120Hz 기기에서도 ms 바닥 17ms를 지킨다.
- 레벨 L은 0~12 사이 연속값이고, 표시할 때 반올림한다.

**계단 폭** (가중 상하법, 목표 정답률 80%. 목숨 모드라서 ACTIVE의 75%보다 높였다. §4 참고. 2026-11-13부터 빠른 눈은 목숨이 없고 80%는 [제품 결정]으로 유지한다 — §4.2 주석)
- 정답이면 L += 0.25, 오답이면 L −= 1.0. 비율 1:4라서 수렴점은 80%다 [Kaernbach 1991].
- 초기 단계: 그 변형의 첫 8시행 또는 반전 2회까지는 두 폭을 모두 2배로 한다(+0.5 / −2.0). 비율은 그대로 유지된다.
- 첫 세션은 L=0(500ms)에서 시작한다. 이후 세션은 직전에 수렴한 L에서 1.0을 뺀 값으로 시작한다. 최고 기록이 아니라 수렴값 기준이다.
- 역치 추정값은 마지막 16개 유효 시행의 L 평균을 ms로 바꾼 값이다.

**변형 사다리** (18개. "변형 18종 이상"인 ACTIVE SOPT 구조와 IHAMS의 진행 순서를 따랐다)

| 단계 | 변형 | 내용 |
|---|---|---|
| 1. 중앙 식별 | V1 | 중앙만, 유사도 1(가장 다름) |
| 2. + 주변 위치 | V2–V4 | 표적 자리를 안 링 → +중간 링 → +바깥 링으로 넓힌다(방해물 없음) |
| 3. + 방해물 | V5–V9 | 방해물 7 → 15 → 23 → 31 → 47개 |
| 4. 중앙 유사도 상승 | V10–V14 | 방해물 47개 상태에서 유사도 3 / 5 / 7 / 8 / 9 |
| 5. 어려운 중앙 과제 | V15–V18 | 중앙에 아이콘 2개를 보여 주고 같음/다름을 판단 + 주변 + 방해물 47개. V17–V18은 동시 소리 과제 추가(높은 음/낮은 음 판별, 소리 켬 설정일 때만) |

- **다음 변형으로 넘어가는 기준** [제품 결정]: 역치 추정값이 V1에서는 ≤ 50ms, V2~V18에서는 ≤ 100ms이고, 마지막 16시행 정답률이 ≥ 75%일 때. ACTIVE도 기준을 충족해야만 난이도를 올렸다 [Ball 2002].
- 넘어가면 L = max(0, 수렴값 − 3)으로 되돌린다. 약 2~3칸 쉬운 노출 시간에서 다시 시작한다는 뜻이다.
- 같은 변형에 4세션 넘게 머물러도 강제로 올리지 않는다. 안에서 노출 시간 적응이 계속 돌기 때문이다.
- 출시 후 사용자 중앙값이 1~2세션에 변형 1개씩 넘어가도록 기준값을 조정한다.
- **[제품 결정 개정 2026-11-13 — 빠른 눈 재설계, `QUICK_EYE_REDESIGN.md`]** 위 기준과 시작점은 다음으로 바뀌었다(#33·#36 주석).
  - 기준(`QUICK_EYE_BARS_MS`): V1 ≤ 100ms, V2 ≤ 167ms, V3–4 ≤ 200ms, V5–9 ≤ 250ms, V10 이상 ≤ 300ms. 중간 회색 판·평균 밝기 마스크로 같은 노출이 더 어려워져서 완화했다.
  - 진급 경로 둘: (a) 반전점 6개 이상의 역치 ≤ 기준 + 최근 16시행 75% 이상, (b) «충분한 증거» — 최근 유효 16시행이 모두 기준 이하 노출이고 14개 이상 정답(역치는 그 16시행 노출의 기하평균). (b)는 플랫폼 바닥(33ms)에서 반전이 생기지 않아 진급이 막히던 문제를 푼다.
  - 시작점: 새 기록은 V2부터. V1은 연습 시행(500→400→333→267ms)으로만 쓰고, 첫 배치(6–10시행, 267ms에서 시작)가 레벨 0.5 이하·별 위치 정답률 50% 미만이면 발표 없이 V1 경로로 내린다. 가운데만 설정은 V1 그대로.
  - 판 휘도 0.185(장소 색조만 다름)·잉크 `#F3F0E8`·마스크 평균을 그 시행 자극 화면 평균에 맞춘다(Michelson 0.40). 준비 신호(fixation 시작의 고리·소리·진동)는 경계(alerting) 요소라 역치가 조금 낮게 나올 수 있다 — 매 시행 같아 계단 비교는 유지되고, 소리·진동 설정으로 끌 수 있다.
  - 피드백은 600ms ✓/✗ 대신 공개 화면(정답 1000 / 절반 1400 / 오답 1600ms, 500ms 뒤부터 넘기기). 무효 시행은 500ms 뒤 다시 낸다 — 어느 경우든 다음 자극까지 1초 이상(1번 7항).
  - 새 규칙 소개 시행 4개의 노출은 L−3, L−2, L−1, L(0 이상). 점수는 정답 1개당 `10 + 10·L + 40·(변형−1)` × 연속 배율(반응 시간 무관).

**타이밍 구현**
- **웹**
  - requestAnimationFrame 루프로 프레임을 센다.
  - 세션 시작 때 rAF 간격 60개의 중앙값으로 화면 주사율을 잰다.
  - 모든 자극은 미리 그려 두고 visibility/opacity 전환만 한다. 노출 시작 순간에 레이아웃 계산이나 이미지 디코딩이 일어나면 안 된다.
  - 실제 시작·종료 시각을 performance.now()로 기록한다.
  - 측정한 노출이 목표와 **1프레임 넘게** 어긋나면(프레임 누락, 탭 숨김) 그 시행은 **무효**다. 계단·목숨·점수에 반영하지 않고 다시 낸다.
  - setTimeout은 쓰지 않는다.
- **React Native**
  - JS 스레드 rAF는 흔들림이 크다. Reanimated `useFrameCallback`이나 Skia처럼 UI 스레드에서 그리는 방식을 쓰고, 프레임 타임스탬프를 기록한다.
  - **바닥은 33ms**(2프레임)로 시작한다. 기기 등급별로 프레임 누락률이 2% 미만으로 확인되면 17ms로 내린다 [제품 결정].
  - 앱이 백그라운드로 가면 그 시행은 무효다.

**점수와 기록**
- 주 기록: "변형 V단계 · 노출 시간 X ms에서 80% 정답". 이 게임의 기록일 뿐이며, 인지 점수가 아니다.
- 보조 점수: 정답 1개당 10점 × (1 + 변형번호/6). 동기 부여용이다.
- 응답 속도 보너스는 없다(응답이 무제한이므로).
- 안내는 최소한으로 한다. ACTIVE 훈련은 전략 교육 없이 반복 연습하는 방식이었다 [Ball 2013]. 변형마다 처음에 점수 없는 연습 시행 4회를 둔다 [Owsley 2013 / Woutersen 2018].

**왜 이 게임이 대표인가.** 8개 게임 중 무작위 대조시험에서 오래 남는 향상이 나온 유형과 맞는 게임이 지금은 하나도 없다. 「빠른 눈」은 그 유형(적응형 처리속도 훈련)을 가장 가깝게 다시 구현한 것이다. 단, 우리 구현 자체는 시험된 적이 없다. 시험된 상용 제품과 같다고 주장하지 않는다.

---

## 3. 세션과 용량 설계

| 항목 | 사양 | 근거 |
|---|---|---|
| **오늘의 훈련** (기본) | 버튼 하나로 끝까지 진행. ① 빠른 눈 약 10분(라운드 최대 4개) + ② 순환 게임 3개 각 3~4분 → **20~25분** 뒤 종료 화면 | 30분 미만은 근거가 약함 [Lampit 2014]. FINGER 10~15분, POINTER 15~20분 |
| 긴 세션 (선택) | 45분: 빠른 눈 20분 + 게임 5개 | ACTIVE는 60~75분 × 10회 [Ball 2002] |
| 순환 규칙 | 3개 중 1개는 반드시 속도 계열(Odd One Out / Number Hunt). 나머지는 기억·추론·다양성 게임을 돌아가며. Match Pairs·Color Word는 2회에 1번 이하 | 처리속도 g=0.31이 가장 큼. 실행기능·주의는 유의하지 않음 [Lampit 2014] |
| **주간 목표** | **주 3회**. 3회를 넘긴 세션에는 추가 보상이 없다(자유 플레이는 가능) | 주 3회 초과는 효과 근거 없음 [Lampit 2014]. FINGER·POINTER도 주 3회 |
| **기본 과정** | 10세션을 4~6주에. 진행 표시 "기본 과정 7/10" | ACTIVE 10세션/5~6주. 세션 수에 따른 효과 증가는 관찰 결과일 뿐임 [Edwards 2017] |
| **복습 과정** (부스터) | 기본 과정을 마치고 **약 11개월 뒤**, **약 35개월 뒤**에 4세션을 2~3주 동안. 앱 안 카드 + 선택형 푸시 | ACTIVE 부스터 일정. 참석률은 76% → 60%로 줄었음 [Ball 2013] |
| 알림 | 주간 계획에 묶는다. 하루 1회 이하, 주 3회 이하. 끊겨도 벌칙이나 "연속 기록 끊김" 표시 없음. 돌아오기 쉽게 "다시 시작" | 대부분 중간에 그만둠: FINGER 전 세션 완료 12% [Turunen 2019] |
| 가벼운 동반 | 선택형으로 가족·친구에게 주간 요약 공유. 미국 연구는 감독 있는 형식 쪽 효과가 컸음 | 집에서 혼자는 g=0.09 [Lampit 2014] |

**사용자에게 보여 줄 진행 지표**
1. 기본 과정 n/10, 이번 주 n/3 (계획 대비 완료율) [Li 2024]
2. 누적 훈련 시간(분)
3. 게임별 레벨 추이 작은 그래프, 빠른 눈의 변형·역치 기록

**보여 주지 않을 것**: 연속 일수(streak)를 주 지표로 쓰지 않는다. "뇌 나이", 합산 "두뇌 점수", 백분위("상위 10% 두뇌")는 만들지 않는다 [Simons 2016; Gates 2020].

**솔직하게 적어 둘 점.** 기본 과정 10세션 × 25분은 약 4시간이다. ACTIVE(약 10~12.5시간)나 IHAMS(10시간)보다 훨씬 적다. 이 차이를 내부 문서에 명시한다.

---

## 4. 목숨·게임오버 규칙

사장님 요구사항은 "N번 틀리면 라운드 끝"이다.

### 4.1 원칙
- 목숨은 **라운드**를 끝낼 뿐이다. 레벨이나 과정 진행은 끝내지 않는다.
- 다음 라운드는 직전 수렴 레벨에서 조금 뺀 값(게임 레벨 −0.5, 빠른 눈 L −1.0)으로 시작한다. **레벨 1로 되돌리지 않는다** [Brehmer 2012; Li 2024].
- 지금 규칙의 "빠른 정답 +0.45"는 **계단에서 빼고 점수에만** 남긴다. 그러지 않으면 빠른 사용자의 목표가 64%로 떨어진다 [Kaernbach 1991].
- 목표 정답률을 올린다. 73% 목표에 목숨 3개면 평균 11시행 만에 라운드가 끝나고, 거의 모든 라운드가 "실패"로 끝난다. 3개 목숨으로 버티는 평균 시행 수는 3/(1−p)다 [Wilson 2019 계산]. 85%는 이론에서 나온 경험칙이지 법칙이 아니다.

### 4.2 게임별 N

| 게임 군 | N | 계단 목표·폭 | 라운드 상한 (클리어) | 기대 길이 |
|---|---|---|---|---|
| **빠른 눈** | **목숨 5개** | 80%: +0.25 / −1.0 | 30시행 | 5/0.2 = 평균 25시행. 약 25%가 클리어 |
| 속도·다양성 게임 (Odd One Out, Number Hunt, Color Word, Quick Math, Number Pattern, Match Pairs) | **목숨 3개** | 85%: +0.15 / −0.85 | 20시행 | 3/0.15 = 평균 20시행. 약 40%가 클리어 |
| 기억 범위 게임 (Sequence, Flash Grid) | **길이마다 기회 2번** (하트 2개, 길이가 바뀌면 다시 채움) | 둘 중 하나라도 맞으면 길이 +1. 같은 길이에서 2번 다 틀리면 라운드 끝 | 없음 | 표준 Corsi 중단 규칙 [Kessels 2000] |

- 초기 단계는 라운드 첫 8시행이다. 이때 두 폭을 모두 2배로 하고 비율은 유지한다.
- **[제품 결정 개정 2026-11-13]** 빠른 눈은 목숨 없이 본 문제 20개짜리 구간으로 바뀌었다(`GROUP_RULES.quickEye.lives = 0`, 상한 20). 구간은 상한·오늘의 훈련 시간 예산·사용자 중지·무효 연속으로만 끝난다. 위 표의 «목숨 5개 / 30시행»은 #44 A/B용 설정값으로만 남기고 효과 주장의 근거로 쓰지 않는다. 80% 목표는 목숨 때문이 아니라 [제품 결정]으로 유지한다(#41 주석).
- 기억 범위 게임 다음 라운드는 max(2, 최고 통과 길이 − 2)에서 시작한다.
- Corsi 중단 규칙은 표준 실시 절차일 뿐, 목숨 규칙으로 "검증"된 것은 아니다. 연구마다 중단 규칙이 다르다(정정 사항 반영).
- **[제품 결정 2026-11-13] 기억 범위 게임의 빠른 진입.** 첫 라운드, 14일 이상 쉬고 돌아온 라운드, 실력 추정치를 다시 연 라운드(`n = 0`)에서만, 첫 실수 전까지: 첫 시도에 맞히면 길이 +2(다음 규칙 레벨은 넘지 않음 — 순서 기억의 거꾸로 L4), 첫 실수는 기회를 쓰지 않고 길이 −1 뒤 표준 Corsi(길이마다 2번). 순간 기억은 3칸, 순서 기억은 연습 뒤 4개(L2)에서 시작. 등급·업적·`spanPassed`에는 **실제로 맞힌 길이만** 센다. 근거: 표준 Corsi는 길이 2~3부터 한 칸씩 올라가 성인이 자기 길이에 닿기 전에 지루해진다. 빠른 진입은 시작점만 바꾸고 중단 규칙·제시 속도(1초에 1개)는 그대로다. 연구에서 검증된 절차가 아니다.
- **[제품 결정 2026-11-13] 같은 그림 찾기의 탐색 사다리.** 연습 뒤 L3 → L6 → L9 → L12 판을 최대 4개, 배치 시행으로(목숨·점수·통계 없음). 본 카드끼리의 실수(정보 있는 실수) 1번 이하로 끝내면 +3·계속, 2번 이상이면 +1·멈춤, 실패하면 멈춤. 계단은 «통과로 올라간 레벨(통과마다 +3 또는 +1) − 0.5»(하나도 통과 못 하면 L2), sd 2에서. 판 하나가 수십 초라 ZEST 8문제는 너무 길다. 처음 뒤집는 카드는 여전히 실수가 아니다(#39).
- 같은 그림의 판마다 «실수 N번까지»는 목숨이 아니라 그 판의 허용치다(하트가 아니라 점으로 표시). 라운드 목숨 3개 규칙은 그대로다.

### 4.3 목숨을 깎지 않는 경우
- 칸 사이 틈, 칸 밖, 판 밖을 누른 경우. 운동 실수이므로 무시하고 누른 자리에 물결만 표시한다 [Kobayashi 2011].
- 프레임이 누락됐거나 앱이 백그라운드로 간 시행(무효 처리).
- 시간 여유 모드(×1.5 / ×2)에서 시간 초과. 계단에는 오답으로 반영하되 목숨은 그대로 둔다. "끔" 모드에서는 시간 초과 자체가 없다 [Der 2006].
- 연습 모드(목숨 없음). 처음 하는 게임은 반드시 연습 라운드를 거친다 [WHO 2026 디지털 문해력; Turunen 2019].
- 시간 여유 모드는 **입력 시간만** 늘린다. 외우는 단계(순간 기억의 보여 주기, 같은 그림의 미리보기, 순서 기억의 깜빡임)는 늘리지 않는다 — 늘리면 기억 과제가 아니라 보고 따라 누르기가 된다(`useBrainRound` trialLimit은 `timeLimitMs`만, 노출은 `pendingMs`). 일시정지도 노출을 처음부터 다시 보여 주지 않는다(남은 시간만).
- 숫자 순서의 시간 초과는 기회를 깎지 않는다(틀린 숫자를 누를 때만). 다른 하나 찾기의 «없음»을 잘못 누른 것은 오답이다(운동 실수가 아니라 판단).

### 4.4 화면 연출
- 하트는 보이되 차분하게 둔다. 빨간 번쩍임, 카운트다운, "GAME OVER" 효과음을 한꺼번에 쓰지 않는다. 게임화는 체감 부담을 키운다(g=−0.52) [Vermeir 2020].
- 종료 화면 제목은 "라운드 끝"이다. 첫 줄은 도달한 최고 레벨과 개인 기록이고, 버튼은 [한 판 더] [오늘 훈련 계속]이다.
- 목숨을 사거나 광고를 보고 채우는 기능은 **만들지 않는다**.

### 4.5 검증 계획
연구 근거가 없는 부분이므로 출시 후 확인한다.
- 게임별로 실제 수렴 정답률을 기록한다.
- 어려운 내용 개편의 모델 값(빠른 계산 구간별 기준 시간과 구간 26~41의 13~21초, 규칙 찾기 15~20초, 다른 하나 찾기의 칸당 시간 `itemMs`, 숫자 순서의 판 종류 배율, 색깔 단어 시계, 같은 그림 6초+쌍당 6초)을 종류별 반응시간 중앙값과 수렴 정답률로 다시 맞춘다. 다른 하나 찾기의 «너무 쉽지 않다» 시험(L24 젊은 성인 시간 초과 ≥ 15%)과 같은 그림의 «기억 50% 플레이어 판 실패 ≥ 30%»는 시험 안의 모델 플레이어로 잰 것이다.
- 60세 이상에서 라운드 완료율, D7/D28 재방문율, 자가보고 좌절감을 잰다.
- 목숨 수를 바꿔(N=3 vs 5) A/B 시험한다.

---

## 5. 고령자 UX 요구사항

| 항목 | 기준 | 출처 |
|---|---|---|
| 게임 칸·버튼 | ≥ 9mm ≈ **56dp/pt**, 권장 **64dp+**. 칸 사이 틈 ≥ 8dp. 누를 수 있는 영역은 보이는 테두리보다 넓게. 칸을 작게 만드는 방식으로 어렵게 하지 않는다. 격자 크기 상한은 화면 너비로 정한다 | 4.7mm 칸은 실수율 39%, 7.8mm는 6.5% [Kobayashi 2011] |
| 일반 UI 버튼 | ≥ 44×44pt(iOS), ≥ 48×48dp(Android). 웹 ≥ 44×44 CSS px(AAA) | Apple HIG; Android; WCAG 2.5.5 |
| 글자 대비 | ≥ 4.5:1(AA). 큰 글자·고대비 모드는 7:1 목표(AAA) | WCAG 1.4.3 / 1.4.6 |
| 비텍스트 대비 | 켜진 칸과 꺼진 칸 ≥ 3:1. 색이 아닌 단서(테두리·아이콘)를 함께 쓴다 | WCAG 1.4.11 |
| 글자 크기 | 시스템 글자 크기(Dynamic Type / fontScale)를 따라 **200%까지 잘림 없이** 커져야 한다. 본문 기본 17pt [제품 결정]. 게임 숫자·자극은 별도로 크게(≥ 28pt) [제품 결정]. 노인이 선호한 읽기 글자 크기는 약 10.5~15pt였고, 20pt는 근거가 없다(정정 반영) | WCAG 1.4.4; Hou 2022 |
| 시간 제한 | 시간 제한 게임에 여유 설정 ×1.5 / ×2 / 끔. "빠름" 판정은 **본인의 최근 정답 20개 반응시간 중앙값**보다 빠를 때. 절대 ms 기준을 쓰지 않는다 | WCAG 2.2.1; Apple HIG; Der 2006 |
| 깜박임 | 1초에 3회 이하. 빠른 눈의 마스크는 평균 밝기를 맞추고 시행 간격 ≥ 1초. 첫 실행 때 광과민성 안내 | WCAG 2.3.1 |
| 제시 속도 | 기억 범위 게임은 1초에 1개 이하 | Kessels 2000 |
| 움직임 | 움직이는 표적을 쓰지 않는다. "동작 줄이기" 설정을 따른다. 모든 라운드에 일시정지 버튼 | WCAG 2.2.2; Apple HIG |
| 색 | Color Word는 색각이상에 안전한 팔레트 + 모양/글자 모드(아직 미구현). 2026-11-13부터 보기 색칠(L8)·테두리 미끼(L14)는 **혼동 쌍 제외** 조건에서만 낸다: `theme.ts` `INK_CONFUSABLE` — `INK_COLORS`를 Viénot 1999·Machado 2009 적록 색각이상(제1·제2) 시뮬레이션으로 CIEDE2000 < 20인 쌍(빨강·초록·노랑·주황끼리, 파랑·보라; 나머지 쌍은 모두 49 이상), 시험이 다시 계산한다. 청황(제3, 약 1/10,000)은 빠져 있다 — 넣으면 초록에 안전한 색이 하나뿐이라 규칙을 못 지킨다. L1의 두 색은 혼동 쌍이 아니다. 숫자 순서의 둘째 줄은 노랑 글씨 **와 네모 테두리**, 다른 하나 찾기의 색 섞임은 밝기로 고른 중립·노랑·하늘(빨강·초록 대비 없음) | 정정 사항(미연구 항목); Viénot 1999; Machado 2009 |
| 처음 사용 | 게임마다 시범 화면 + 점수 없는 연습 시행. 텍스트와 그림 안내를 8개 로케일 모두에. "쉽게 시작" 선택지 | Turunen 2019; WHO 2026 |
| 진입 | 큰 "오늘의 훈련 시작" 버튼 하나로 세션 전체를 순서대로 진행 | Turunen 2019(Zhang: "더 단순했으면") |

---

## 6. 주장과 문구

### 6.1 적용 규칙
- **식약처 웰니스 판단기준(2026-02 개정)**: 질병 예방 목적이면 의료기기다. "치매 등 인지기능 장애 환자를 대상으로 인지기능을 평가하고 맞춤 콘텐츠로 인지 능력 개선·치료"하는 소프트웨어는 **의료기기 예시**로 적혀 있다. 우리 앱의 적응형 맞춤에 치매 대상층을 더하면 이 예시와 똑같아진다. 질병 이름 없이 "정신적 예민함 유지"는 웰니스로 허용된다. 사용 목적은 표시·광고·구두·서면으로 판단한다.
- **의료기기법**: [시행 2026.10.20] 법률 제22105호, 제26조⑦은 의료기기가 아닌 제품을 의료기기처럼 효능이 있다고 오인시키는 광고를 금지한다.
- **표시광고법**: 제5조에 따라 요청을 받으면 15일 안에 실증 자료를 내야 한다. 제9조 과징금은 관련 매출의 2% 이내(매출이 없으면 5억 원 이내)다.
- **FTC v. Lumos Labs (2016)**: 노화로 인한 인지 저하 지연, 치매·MCI 예방, 업무·학업 향상, "과학적 입증" 주장을 기만으로 판단했다.
- **Apple 1.4.1·2.3.1 / Google Play 건강 정책**: 의사와 상담하라는 안내를 넣는다. "의료기기가 아님" 문구를 넣는다. 건강 앱 신고서를 작성한다. 스토어 카테고리는 **교육**으로 하고 의료로 하지 않는다.
- **내부 관리**: 주장 → 출처 대조표를 관리한다(표시광고법 15일 대응용). "논문 기반"은 **방법**을 설명할 때만 쓰고, **효과**를 말할 때는 쓰지 않는다.

### 6.2 금지어 (UI·스토어·푸시·광고·SNS·고객 응대 전부, 8개 로케일)

| KO | EN |
|---|---|
| 치매 예방 / 치매 위험 감소 / 치매 진행 지연 / 치매 치료 | prevent dementia / reduce dementia risk / delay Alzheimer's |
| 경도인지장애 개선, 인지장애 개선 | improves MCI / cognitive impairment |
| 뇌 노화 방지, 뇌 나이(진단) | anti-aging brain, brain age |
| 기억력 향상 / 인지기능 향상 입증 / 기억력 23% 향상 | improves memory / boosts IQ / X% better memory |
| 과학적으로 입증 / 임상적으로 검증 / 논문으로 효과 확인 | scientifically / clinically proven |
| 치매 위험도 / 인지 수준 평가 / 두뇌 점수 | dementia risk score / cognitive assessment |
| 일·공부 성과 향상, 일상생활 능력 향상 | better at work/school, improves daily functioning |
| WHO 권장 치매 예방 게임 | WHO-recommended dementia game |
| 크로스워드보다 효과적 (비교 주장) | more effective than puzzles |
| 치료 | therapy, treatment |

다른 로케일에서도 같은 개념을 막는다. 예: ja 認知症予防·脳年齢, zh 预防痴呆·大脑年龄, es prevenir la demencia·edad cerebral, vi phòng ngừa sa sút trí tuệ, th ป้องกันสมองเสื่อม, id mencegah demensia. 각 로케일은 원어민 검수를 거친다.

**허용 표현**: 두뇌 활동, 두뇌 게임, 집중력·기억력 연습, 꾸준한 두뇌 운동 습관, 게임 기록 향상, "이 게임 실력이 늘었어요" / brain games, focus and memory practice, a regular brain-activity habit, your game record improved.

### 6.3 메뉴 이름·부제
- KO 메뉴: **두뇌 트레이닝**. 부제: **집중력·기억 게임으로 만드는 꾸준한 두뇌 활동 습관**
- EN 메뉴: **Brain Training**. 부제: **Focus and memory games for a regular brain-activity habit**
- 하단 고정 문구
  - KO: 이 기능은 의료기기가 아니며 질병의 진단·치료·예방을 목적으로 하지 않습니다. 기억력이 걱정되면 가까운 치매안심센터나 의사와 상담하세요.
  - EN: This feature is not a medical device and is not intended to diagnose, treat, cure, or prevent any medical condition. If you are concerned about your memory, please talk to a doctor.

### 6.4 결과 화면·푸시 문구 예시
- 결과: "숫자 찾기 레벨 5.2 → 6.0 · 이 게임 기록이 좋아졌어요" / "Number Hunt level 5.2 → 6.0 · Your record in this game improved"
- 푸시: "이번 주 두뇌 훈련 2/3회 — 오늘 20분 어떠세요?" / "Brain training this week: 2 of 3 — ready for 20 minutes today?"

### 6.5 스토어 문구 초안

**KO**
> 두뇌 트레이닝 — 집중력·기억 게임으로 꾸준한 두뇌 활동 습관을 만드세요. 「빠른 눈」을 포함한 9가지 게임은 실력에 맞춰 난이도가 자동으로 조절되고, 주 3회·20분 정도의 「오늘의 훈련」으로 계획을 세워 기록을 확인할 수 있습니다. 큰 버튼, 글자 크기 조절, 시간 여유 설정을 지원합니다.
> 이 앱은 의료기기가 아니며 질병의 진단·치료·예방을 목적으로 하지 않습니다.

**EN**
> Brain Training — build a regular brain-activity habit with focus and memory games. Nine games, including Quick Eye, adjust their difficulty to you automatically. Plan about three 20-minute sessions a week and track your game records. Large buttons, adjustable text size and relaxed timing are built in.
> This app is not a medical device and does not diagnose, treat, cure, or prevent any medical condition.

App Review 메모: "General brain games for wellness/education. No diagnosis, treatment, prevention or assessment claims; no cognitive score."

### 6.6 「연구 근거」 페이지 전문

**[KO] 연구 근거**

> **이 기능은 무엇인가요**
> 두뇌 트레이닝은 집중력과 기억을 쓰는 게임으로 꾸준한 두뇌 활동 습관을 만들도록 돕는 기능입니다. 의료기기가 아니며, 질병의 진단·치료·예방을 목적으로 하지 않습니다.
>
> **어떤 연구를 참고했나요 — 효과가 아니라 "방법"입니다**
> - **「빠른 눈」**: 미국의 대규모 노인 인지훈련 연구(ACTIVE)와 후속 연구(IHAMS)에서 쓰인 처리속도 훈련 방식을 참고했습니다. 화면 가운데와 가장자리에 그림이 아주 짧게 나타나면 무엇이 어디에 있었는지 고르는 과제로, 실력에 따라 보이는 시간이 짧아지고 방해물이 늘어납니다. 이 연구들에서 처리속도 훈련을 받은 사람들은 같은 종류의 과제 점수가 크게 올랐고, 그 향상은 10년 뒤에도 일부 남아 있었습니다. 다만 그 연구는 강사가 진행하는 수업이었고, 이 앱의 게임은 그 프로그램과 같지 않으며 연구로 검증되지 않았습니다.
> - **난이도 자동 조절**: 정답률이 일정 수준(약 80~85%)에 머물도록 난이도를 조금씩 올리고 내리는 심리학의 '가중 상하법'을 썼습니다. 연구에 따르면 쉬운 수준에 머무는 것보다 실력에 맞춘 난이도가 훈련 과제 향상에 더 효과적이었습니다.
> - **주 3회, 20~30분**: 여러 연구를 모은 분석에서 주 3회 이하로 훈련한 연구들이 그보다 자주 한 연구들보다 결과가 좋았고, 30분 미만 세션은 근거가 약했습니다. 그래서 매일 짧게 하기보다 주 3회 정도의 「오늘의 훈련」을 기본으로 했습니다.
> - **기본 과정과 복습 과정**: 위 연구는 10회 수업 뒤 약 1년, 3년 시점에 복습 수업을 했습니다. 이 구조를 빌려 10세션 기본 과정과 복습 과정을 만들었습니다.
>
> **연구가 보여 준 것과 보여 주지 못한 것**
> - 인지훈련을 하면 **훈련한 과제는** 확실히 잘하게 됩니다. 하지만 다른 능력이나 일상생활로 옮겨 간다는 근거는 약합니다.
> - 여러 연구를 종합한 코크란 리뷰에서도 효과는 작고, 1년 뒤에는 유지된다는 근거가 없었습니다.
> - 세계보건기구(WHO)의 2026년 지침은 인지훈련을 노인에게 "제공할 수 있다"고 보지만, 근거의 확실성은 **낮다**고 평가했고 가장 좋은 종류와 빈도는 아직 모른다고 밝혔습니다.
> - 그래서 게임 레벨은 **그 게임의 실력**일 뿐, 기억력이나 두뇌 건강을 재는 점수가 아닙니다.
> - 인지훈련이 치매를 예방한다는 것은 확인되지 않았습니다. 이 앱은 그런 효과를 주장하지 않습니다.
>
> **두뇌 건강을 위해 함께 챙기면 좋은 습관**
> 규칙적으로 걷기 등 몸 움직이기, 가족·친구와 자주 만나고 이야기하기, 혈압·콜레스테롤 관리, 청력·시력 검사와 보청기 사용, 금연과 절주, 머리 다치지 않기.
>
> **기억력이 걱정된다면**
> 게임을 더 하기보다 가까운 보건소·치매안심센터나 의사와 상담하세요. 만 60세 이상은 보건소에서 무료 검진을 받을 수 있습니다.
>
> **참고문헌**: 아래 목록

**[EN] Research basis**

> **What this feature is**
> Brain Training helps you build a regular brain-activity habit with games that use focus and memory. It is not a medical device and is not intended to diagnose, treat, cure, or prevent any medical condition.
>
> **What research we drew on — for methods, not results**
> - **Quick Eye** is modeled on the speed-of-processing training used in a large US study of older adults (ACTIVE) and a follow-up trial (IHAMS). Pictures flash briefly in the centre and edges of the screen and you report what and where they were; display time shortens and distractors increase as you improve. People in those studies improved strongly on this kind of task, and part of the gain was still measurable ten years later. Those studies used trainer-led classes; our game is not the same program and has not been tested in a study.
> - **Automatic difficulty** uses a weighted up-down rule from psychology that keeps your accuracy around 80–85%. Research found that difficulty matched to your level improved trained tasks more than staying at an easy level.
> - **Three sessions a week, 20–30 minutes**: in a pooled analysis, studies that trained three times a week or less did better than those that trained more often, and sessions under 30 minutes had weak evidence. So the default is about three "Today's Training" sessions a week, not a daily streak.
> - **Core course and refresher course**: the study above added refresher classes about one and three years after ten sessions. We borrowed that structure.
>
> **What the research shows — and what it doesn't**
> - Brain training reliably makes you better at **the trained tasks**. Evidence that this carries over to other abilities or everyday life is weak.
> - A Cochrane review found small benefits that were not shown to last a year.
> - The World Health Organization's 2026 guideline says cognitive training "may be offered" to older adults, rates the certainty of evidence as **low**, and says the best type and frequency are not known.
> - Your game levels show your skill **at that game**. They are not a measure of memory or brain health.
> - It has not been shown that brain training prevents dementia, and this app makes no such claim.
>
> **Habits worth pairing with it**
> Regular physical activity such as walking, frequent contact with family and friends, managing blood pressure and cholesterol, checking hearing and vision (and using hearing aids if needed), not smoking, drinking less, and protecting your head.
>
> **If you are worried about your memory**
> Please talk to a doctor or a local health service rather than playing more games.
>
> **References**: list below

**[선택 단락 B — 법무 검토 또는 식약처 「의료기기 해당 여부 질의」 후에만 게시]**

> KO: 「ACTIVE 연구의 장기 분석에서는 처리속도 훈련에 대해 엇갈린 결과가 나왔고 전문가 사이에 논쟁이 있습니다. 이 결과는 이 앱에 적용되지 않습니다.」
> EN: "Long-term analyses of the ACTIVE study reported mixed findings for speed training, which experts dispute. These findings do not apply to this app."

HR 0.75나 "치매 위험 n% 감소" 같은 수치는 어떤 경우에도 게시하지 않는다.

**참고문헌** (페이지 하단에 그대로 싣는다)
1. Ball K, et al. (2002). Effects of cognitive training interventions with older adults: a randomized controlled trial. *JAMA* 288(18):2271–2281. https://doi.org/10.1001/jama.288.18.2271
2. Rebok GW, et al. (2014). Ten-year effects of the ACTIVE cognitive training trial on cognition and everyday functioning in older adults. *J Am Geriatr Soc* 62(1):16–24. https://doi.org/10.1111/jgs.12607
3. Ball KK, et al. (2013). Speed of processing training in the ACTIVE study: how much is needed and who benefits? *J Aging Health* 25(8 Suppl):65S–84S. https://doi.org/10.1177/0898264312470167
4. Wolinsky FD, et al. (2013). A randomized controlled trial of cognitive training using a visual speed of processing intervention in middle aged and older adults. *PLoS One* 8(5):e61624. https://doi.org/10.1371/journal.pone.0061624
5. Edwards JD, et al. (2018). Systematic review and meta-analyses of useful field of view cognitive training. *Neurosci Biobehav Rev* 84:72–91. https://doi.org/10.1016/j.neubiorev.2017.11.004
6. Kaernbach C. (1991). Simple adaptive testing with the weighted up-down method. *Percept Psychophys* 49(3):227–229. https://doi.org/10.3758/BF03214307
7. Brehmer Y, et al. (2012). Working-memory training in younger and older adults: training gains, transfer, and maintenance. *Front Hum Neurosci* 6:63. https://doi.org/10.3389/fnhum.2012.00063
8. Lampit A, et al. (2014). Computerized cognitive training in cognitively healthy older adults: a systematic review and meta-analysis of effect modifiers. *PLoS Med* 11(11):e1001756. https://doi.org/10.1371/journal.pmed.1001756
9. Gates NJ, et al. (2020). Computerised cognitive training for 12 or more weeks for maintaining cognitive function in cognitively healthy people in late life. *Cochrane Database Syst Rev* CD012277.pub3. https://doi.org/10.1002/14651858.CD012277.pub3
10. Simons DJ, et al. (2016). Do "brain-training" programs work? *Psychol Sci Public Interest* 17(3):103–186. https://doi.org/10.1177/1529100616661983
11. World Health Organization. (2026). *Risk reduction of cognitive decline and dementia: WHO guidelines, 2nd ed.* ISBN 978-92-4-012355-7. https://www.who.int/publications/i/item/9789240123557
12. Livingston G, et al. (2024). Dementia prevention, intervention, and care: 2024 report of the Lancet standing Commission. *Lancet* 404(10452):572–628. https://doi.org/10.1016/S0140-6736(24)01296-0
13. 보건복지부 (2014, 국민건강보험공단 웹진 2023-09 재수록). 생활수칙 3·3·3. https://www.nhis.or.kr/static/alim/paper/oldpaper/202309/sub/section1_4.html

**내부 근거 대조표에만 두는 문헌** (페이지에는 싣지 않음): Edwards 2017 (doi:10.1016/j.trci.2017.09.002), Coe 2026 (doi:10.1002/trc2.70197), Dickens 2026 (doi:10.1002/trc2.70280), Unverzagt 2012 (doi:10.1017/S1355617711001470), Gates 2019 (doi:10.1002/14651858.CD012279.pub2), Devanand 2022 (doi:10.1056/EVIDoa2200121), NASEM 2017 (doi:10.17226/24782), Melby-Lervåg 2016 (doi:10.1177/1745691616635612), Owen 2010 (doi:10.1038/nature09042), Ngandu 2015 (doi:10.1016/S0140-6736(15)60461-5), Baker 2025 (JAMA 334(8):681–691, doi:10.1001/jama.2025.12923), Li 2024 (doi:10.1093/ageing/afad247), Turunen 2019 (doi:10.1371/journal.pone.0219541), Owsley 2013 (doi:10.1016/j.visres.2012.11.014), Levitt 1971 (doi:10.1121/1.1912375), Wilson 2019 (doi:10.1038/s41467-019-12552-4), Kessels 2000 (doi:10.1207/S15324826AN0704_8), Kobayashi 2011 (INTERACT, LNCS 6946:83–99), Der 2006 (doi:10.1037/0882-7974.21.1.62), Vermeir 2020 (doi:10.2196/18644), Hou 2022 (doi:10.3389/fpsyg.2022.931646), WCAG 2.2, FTC 2016 Lumos 보도자료, Apple 가이드라인 1.4.1/2.3.1, Google Play 건강 정책, 식약처 웰니스 판단기준(2026-02).

---

## 7. 만들지 말 것, 주장하지 말 것

1. "치매 예방", "뇌 나이", "치매 위험도", "인지 수준 평가" 같은 기능이나 이름. 합산 두뇌 점수, 백분위 순위.
2. MCI·치매 환자나 기억력이 걱정된다는 사용자를 겨냥한 안내·광고. 그런 사용자에게는 게임 대신 의료기관을 안내한다. 이런 사람을 대상으로 맞춤 훈련을 하면 식약처 의료기기 예시에 해당한다.
3. ACTIVE 수치(HR 0.71 / 0.75, "25% 감소", 세션당 10%)를 스토어·푸시·광고·온보딩에 쓰는 것. "연구에서 효과가 검증된 게임"이라는 표현.
4. 효과를 말하는 "논문 기반/과학적 입증/임상 검증". WHO 이름을 권장 마크처럼 쓰는 것.
5. 크로스워드나 다른 앱보다 낫다는 비교 주장. 보상을 주고 받은 후기를 밝히지 않고 쓰는 것.
6. 상표인 UFOV, Double Decision, BrainHQ, Road Tour를 쓰거나 그 제품과 같다고 암시하는 것.
7. 목숨 구매·광고 시청으로 목숨 채우기. 실패하면 레벨 1로 되돌리기. 운동 실수(칸 밖 탭)로 목숨 깎기.
8. 칸을 작게 만드는 방식으로 어렵게 하기. 절대 ms로 "빠름" 판정하기. 빠른 정답 보너스를 계단에 넣기(목표가 64%로 밀림).
9. 끝없이 하는 모드를 기본 경로로 두기. 연속 일수를 주 지표로 쓰기. 주 3회를 넘긴 플레이에 추가 보상 주기.
10. n-back 같은 작업기억 과제를 "기억력 부스터"로 홍보하기.
11. 빠른 눈 노출 시간을 setTimeout으로 만들기. 프레임 누락 시행을 계단·목숨에 반영하기. 1초에 3회 넘는 깜박임.
12. 스토어 카테고리를 "의료"로 두기. 식약처 「의료기기 해당 여부 질의」 없이 치매 관련 문구를 넣기.

**나중에 다시 볼 것**
- PACT 시험(NCT03848312, N=7,600, 임상 진단 MCI·치매가 주 결과, 주요 완료 예정 2028-01): 결과가 나오기 전에는 치매 관련 주장을 하지 않는다.
- 8개 로케일 시장별 건강 주장 규제(일본 약기법, EU MDR, 동남아): 이번에 조사하지 않았다.

---

## 부록 B. 비판 검토(출시본에 반영)

1. **(a/b) §1 #2 attributes a finding to the wrong paper.**
   - Change: 「작업기억 훈련(Flash Grid·Sequence 계열)은 위약 효과와 출판 편향을 통제하면 다른 능력으로 옮겨가는 효과가 0이다 [Melby-Lervåg 2016].」
   - To: 「작업기억 훈련(Flash Grid·Sequence 계열)은 비슷한 작업기억 과제로는 단기적으로 옮겨가지만, 추론·지능 같은 먼 능력으로는 처치 대조군 대비 설득력 있는 전이가 없다 [Melby-Lervåg 2016]. 위약·출판 편향을 통제하면 먼 전이 효과크기가 0이었다는 2차 메타분석도 있다 [Sala 2019].」
   - Add to the internal list: Sala G, et al. (2019). Collabra: Psychology. doi:10.1525/collabra.203.

2. **(a) §1 #2 overstates how little UFOV carries into daily life.**
   - Change: 「다른 능력이나 일상으로 옮겨가는 효과는 거의 없다」
   - To: 「다른 능력이나 일상으로 옮겨가는 효과는 작거나 불확실하다(UFOV 계열은 자기보고 IADL d=0.27·운전 사고 OR 0.50 신호가 있으나 자기보고·이차 분석이다 [Edwards 2018; Rebok 2014]. 이 신호는 제품 주장에 쓰지 않는다)」

3. **(d) §1 #4 and #5 leave out conflicts of interest.** Append to both rows: 「이해상충: Ball은 Posit Science 주식 보유(Coe 2026에 공시). Edwards는 2007년 Posit 자문(Edwards 2018 공시, 원문 미확인). Wolinsky는 2007-12~2009-03 Posit 파트타임 자문이었으나 논문은 이해상충 없음으로 신고했다. 근거 대부분이 같은 연구 그룹에서 나왔다.」

4. **(a) §1 #4 does not say that the outcome test looks almost like the training.**
   - Change: 「메타분석에서 적응형은 d=0.89였다.」
   - To: 「메타분석에서 UFOV 검사 자체(훈련 과제와 거의 같은 근전이 측정치)에 대한 적응형 효과는 d=0.89였다.」
   - Add after 「추론 74%, 기억 26%였다」: 「(각 군이 자기 훈련 능력을 잰 결과이며, 처리속도 결과 검사는 훈련 과제와 매우 비슷하다)」

5. **(a) §1 #9 uses an unverified comparison and overstates it.**
   - Change: 「적응형 난이도가 효과의 핵심이다. 쉬운 수준에 고정하는 것보다 향상이 컸다 [Brehmer 2012; Edwards 2018].」
   - To: 「적응형 난이도는 훈련 과제 향상을 키우는 것으로 보인다. 작은 RCT(노인 n=45, 작업기억)에서 쉬운 수준 고정보다 훈련 향상이 컸다 [Brehmer 2012]. UFOV 메타분석의 적응형 d=0.89 vs 부분 적응형 d=0.75 비교는 연구 간 비교이고, 0.75는 원문으로 확인하지 못했다 [Edwards 2018].」
   - Change the grade 「보통」 to 「보통→약함」.

6. **(a) §1 #11 treats "no effect detected" as "no effect".**
   - Change: 「인지 효과는 없었다 [Vermeir 2020]」
   - To: 「인지 결과에 대한 효과는 검출되지 않았다(메타분석 RCT 9개로 적음) [Vermeir 2020]」

7. **(d) §1 #5 is missing caveats and the authors' rebuttal.** Append: 「Coe 2026: 추적 중 77% 사망(경쟁위험). 부스터는 초기 8/10회 이상 완료자에게만 제공됐으므로 "처리속도+부스터 vs 전체 대조군"은 완료자 선택이 섞인 비교다. Dickens 2026에는 원저자 반박이 있다(Gross 2026, doi:10.1002/trc2.70290: 각 군이 별개의 사전 가설이라 보정이 불필요하다는 입장). Edwards 2017: 탈락 30.6%, 회기당 HR 0.90은 관찰적 용량-반응이다.」

8. **(d) §1 #6 conflates "no conversion evidence" with "no evidence" and lacks regulatory context.**
   - Change the grade 「근거 없음」 to 「치매 전환: 근거 없음 / 인지검사 점수: 약함」.
   - Append: 「비코크란 메타분석은 MCI 인지검사 g=0.35를 보고했다 [Hill 2017, doi:10.1176/appi.ajp.2016.16030360]. 한국에서는 MCI 대상 앱 인지훈련이 디지털치료기기로 허가됐다(코그테라, 2025-05-23, 언론 보도 기준). MCI 대상 인지훈련은 이미 규제 영역이다. WHO 2026의 '제공할 수 있다' 대상에는 MCI도 포함된다.」

9. **(a) §1 #3 overstates the speed-domain lead.**
   - Change: 「처리속도 g=0.31이 가장 크다」
   - To: 「처리속도 g=0.31(0.11–0.50)이 가장 컸지만 시공간 0.30과 거의 같고 신뢰구간이 겹친다」
   - Make the same change in the §3 순환 규칙 rationale (「처리속도 g=0.31이 가장 큼」).
   - Add the commercial-game meta-analysis: Bonnechère 2020 (60세 이상, 16 RCT, 처리속도 SMD 0.40), doi:10.1038/s41598-020-72281-3.

10. **(a) The §1 conclusion breaks the spec's own rule in §6.1.**
    - Change: 「"근거 있는 훈련 방식을 참고한, 꾸준한 두뇌 활동"까지다」
    - To: 「"연구에서 쓰인 훈련 방식을 참고한 꾸준한 두뇌 활동"까지다(효과 주장 없음)」

11. **(a) §2.1 Number Pattern equates practice with ACTIVE's strategy teaching.**
    - Change: 「ACTIVE 추론 훈련과 같은 계열. 추론 능력 10년 효과크기 0.23 [Rebok 2014]」
    - To: 「ACTIVE 추론 훈련(강사가 수열 규칙 찾기 전략을 가르친 수업)과 과제 소재만 비슷하다. 전략 교육 없는 연습 게임이라 Rebok 2014의 10년 효과크기 0.23을 이 게임 근거로 쓰지 않는다」

12. **(b) §4.1 credits our own arithmetic to Wilson.**
    - Change: 「[Wilson 2019 계산]」
    - To: 「[자체 계산. 85% 목표의 이론적 배경만 Wilson 2019]」

13. **(a) §4.1 cites studies that never tested the no-reset rule.**
    - Change: 「**레벨 1로 되돌리지 않는다** [Brehmer 2012; Li 2024].」
    - To: 「**레벨 1로 되돌리지 않는다** [추론: 적응형 유지가 쉬운 수준 고정보다 낫다는 Brehmer 2012, 순응도가 효과 조건이라는 Li 2024에서 유추. 되돌리기 규칙 자체를 시험한 연구는 없다].」

14. **(a/b) §3 has a vague source, and a weekly summary is not supervision.**
    - Change: 「미국 연구는 감독 있는 형식 쪽 효과가 컸음」
    - To: 「연구 간 비교에서 집단 형식(g=0.29)이 집 형식(g=0.09)보다 컸다 [Lampit 2014]. 주간 요약 공유가 집단·감독 형식의 효과를 재현한다는 근거는 없다」

15. **(a/c) Session length contradicts the cited evidence: the spec says under 30 min is weak, then sets the default at 20–25 min.** Choose one of the following and apply it everywhere (§3, the research page, the store copy and the push).
    - Option A: default 「오늘의 훈련」 to 30분.
    - Option B: keep 20–25분 and state the gap honestly.
      - KO research page, change: 「30분 미만 세션은 근거가 약했습니다. 그래서 매일 짧게 하기보다 주 3회 정도의 「오늘의 훈련」을 기본으로 했습니다.」 To: 「30분 미만 세션은 근거가 약했습니다. 「오늘의 훈련」은 부담을 줄이려고 20~25분으로 정했기 때문에 이 기준보다 짧습니다. 이 비교는 서로 다른 연구를 견준 것이라 확실하지 않습니다.」
      - Mirror this in EN: 「Sessions under 30 minutes had weak evidence; Today's Training is 20–25 minutes to keep it manageable, which is shorter than that. These comparisons are across different studies and are uncertain.」
    - Also align the store copy 「주 3회·20분 정도」 / 「about three 20-minute sessions」 with the 20~25분 in §3.

16. **(a/c) The research page states results under a heading that says it covers methods, and the results are inflated.** Under 「어떤 연구를 참고했나요 — 효과가 아니라 "방법"입니다」, the 「빠른 눈」 bullet reports outcomes.
    - Remove: 「이 연구들에서 처리속도 훈련을 받은 사람들은 같은 종류의 과제 점수가 크게 올랐고, 그 향상은 10년 뒤에도 일부 남아 있었습니다.」
    - Add to 「연구가 보여 준 것과 보여 주지 못한 것」: 「처리속도 훈련을 받은 사람들은 훈련과 거의 같은 검사의 점수가 올랐고, 10년 뒤에도 일부 차이가 남았습니다. 기억력 같은 다른 능력으로는 옮겨 가지 않았습니다. 그 연구의 훈련은 약 10~12시간이었고, 이 앱의 기본 과정(약 4시간)보다 훨씬 깁니다.」
    - EN: delete 「People in those studies improved strongly on this kind of task, and part of the gain was still measurable ten years later.」 Add the equivalent under "What the research shows": 「People in that study improved on tests very similar to the training, and some difference remained ten years later. The gains did not carry over to other abilities such as memory. That training took about 10–12 hours, far more than this app's core course (about 4 hours).」

17. **(b) "Trainer-led classes" is factually wrong, because IHAMS had an at-home arm.**
    - Change: 「다만 그 연구는 강사가 진행하는 수업이었고」 To: 「다만 ACTIVE는 강사가 진행하는 소규모 수업이었고(IHAMS에는 집에서 혼자 한 집단도 있었습니다)」
    - EN, change: 「Those studies used trainer-led classes」 To: 「ACTIVE used small trainer-led classes (IHAMS also had an at-home group)」

18. **(b) Booster paragraph: "the study above" is ambiguous.**
    - Change: 「위 연구는 10회 수업 뒤 약 1년, 3년 시점에 복습 수업을 했습니다」 To: 「ACTIVE 연구는 10회 수업을 마친 참가자 중 일부에게 약 1년, 3년 시점에 복습 수업을 했습니다」
    - EN, change: 「the study above added refresher classes」 To: 「ACTIVE offered refresher classes to some participants who completed」

19. **(a) Present the frequency claim on the research page as uncertain.**
    - Change: 「주 3회 이하로 훈련한 연구들이 그보다 자주 한 연구들보다 결과가 좋았고」 To: 「주 3회 이하로 훈련한 연구들이 그보다 자주 한 연구들보다 결과가 좋았지만, 서로 다른 연구를 비교한 것이라 확실하지 않습니다.」
    - Mirror in EN: 「…did better than those that trained more often, though this compares different studies and is uncertain.」

20. **(b/c) Reference 13 is renamed, which hides "치매".**
    - Change: 「보건복지부 (2014, 국민건강보험공단 웹진 2023-09 재수록). 생활수칙 3·3·3.」
    - To the real title: 「치매예방수칙 3·3·3」.
    - Then move it, together with refs 11 and 12, behind the gate in item 21. Changing a source title to avoid a regulated word is itself a misrepresentation risk.

21. **(c) Gate the whole research page, not just paragraph B.** MFDS judges intended use from the net impression of 표시·광고. A page that cites the WHO dementia risk-reduction guideline, the Lancet dementia-prevention commission and a "치매예방수칙", next to "두뇌 건강을 위해 함께 챙기면 좋은 습관", can create a dementia-prevention purpose despite the disclaimer. Partial quoting of WHO also drops its purpose clause ("To reduce the risk of cognitive decline and/or dementia…").
    - Change: 「**[선택 단락 B — 법무 검토 또는 식약처 「의료기기 해당 여부 질의」 후에만 게시]**」
    - To: 「**[출시 게이트: §6.6 페이지 전체 — 특히 WHO 문단, 습관 카드, 참고문헌 11–13, 단락 B — 는 법무 검토 또는 식약처 「의료기기 해당 여부 질의」 회신 후에만 게시. 그 전에는 방법 설명(Kaernbach·ACTIVE 과제 구조)과 "치매 예방 효과 없음" 문장만 게시]**」
    - Change the heading 「두뇌 건강을 위해 함께 챙기면 좋은 습관」 to 「건강한 생활을 위해 함께 챙기면 좋은 습관」.

22. **(c) The free-screening line is imprecise.**
    - Change: 「만 60세 이상은 보건소에서 무료 검진을 받을 수 있습니다.」
    - To: 「만 60세 이상은 보건소(치매안심센터)에서 무료로 인지 선별검사를 받을 수 있습니다.」
    - Reason: follow-up diagnostic and differential tests have income criteria, so "무료 검진" overpromises.

23. **(c/d) Referrals must work outside Korea.** In §6.3 and the research page, add: 「치매안심센터·보건소 안내는 ko 로케일 전용. 다른 7개 로케일은 'talk to a doctor or local health service'만 쓰고, 국가별 기관명은 원어민·현지 검토 후 추가」.

24. **(c) §6.2 is missing claim types that FTC v. Lumos named.** Add rows:
    - 「인지 저하 지연 / 나이 들며 생기는 기억력 감퇴 늦추기 | delay/slow age-related cognitive decline」
    - 「집중력 향상·개선, 처리속도 향상, 두뇌 회춘, 지능(IQ) 향상 | improves focus/attention, faster thinking, sharper mind」
    - 「ADHD·뇌졸중·외상성 뇌손상·PTSD·우울증에 도움 | helps ADHD, stroke, TBI, PTSD, depression」
    - 「운전 능력 향상·사고 감소 | safer driving」
    - Add a note: 「금지어 린트는 고정 면책 문구('diagnose, treat, cure, or prevent')를 예외 처리한다」.

25. **(c) The Quick Eye record looks like a cognitive assessment.** A "ms at 80% correct" threshold is in effect a UFOV score, which is a validated assessment. Combined with adaptive personalisation, it moves toward the MFDS 「인지기능 평가·분석 + 맞춤형 콘텐츠」 device example and Apple 1.4.1 scrutiny.
    - Change: 「주 기록: "변형 V단계 · 노출 시간 X ms에서 80% 정답". 이 게임의 기록일 뿐이며, 인지 점수가 아니다.」
    - To: 「주 기록(사용자 표시): "빠른 눈 단계 V · 속도 레벨 L/12". ms 역치는 내부 로그에만 둔다. 연령 규준 비교, 시간에 따른 '저하' 경고, ms 표시는 하지 않는다.」
    - Apply the same to item 3 of 「사용자에게 보여 줄 진행 지표」 (「빠른 눈의 변형·역치 기록」 becomes 「빠른 눈의 단계·레벨 기록」).

26. **(c/d) The family sharing summary could work as cognitive monitoring and has privacy implications.**
    - Change: 「선택형으로 가족·친구에게 주간 요약 공유」
    - To: 「선택형으로 가족·친구에게 주간 요약 공유. 공유 내용은 완료 횟수·훈련 시간(순응도)만이고, 레벨·역치·추이는 공유하지 않는다. 제3자 제공 동의를 따로 받는다(개인정보보호법 제17조)」

27. **(c) §7.2 must not trigger referrals from gameplay.**
    - Change: 「그런 사용자에게는 게임 대신 의료기관을 안내한다.」
    - To: 「그런 사용자에게는 게임 대신 의료기관을 안내한다. 안내는 고정 문구, 또는 사용자가 스스로 걱정을 밝힌 경우에만 띄운다. 게임 성적·저하 추이로 안내를 띄우지 않는다(성적 기반 안내는 평가·진단 행위로 해석될 수 있다). 게임 기록에서 '인지 상태'를 추론·저장하지 않는다(민감정보, 개인정보보호법 제23조)」

28. **(c) §6.1 conflates the Apple and Google rules.**
    - Change: 「Apple 1.4.1·2.3.1 / Google Play 건강 정책: 의사와 상담하라는 안내를 넣는다. "의료기기가 아님" 문구를 넣는다. 건강 앱 신고서를 작성한다.」
    - To: 「Apple 1.4.1: 의료 앱 심사 강화. 정확도 공개 의무는 건강 '측정' 정확도 주장에만 적용되고, 의사 상담 권고를 넣는다. Apple 2.3.1: 오인 마케팅이면 삭제된다. Google Play: 모든 앱이 Health apps declaration(Play Console > App content)을 작성하고, 설명란에 'not a medical device…' 문구를 넣는다(문구 범위는 신고서 화면에서 재확인)」

29. **(c/d) Missing Korean rules: accessibility, push and endorsements.** Add to §6.1:
    - 「장애인차별금지법·KWCAG 2.2·모바일 앱 접근성 지침(웹 WCAG만으로 부족)」
    - 「정보통신망법 제50조: 광고성 푸시는 사전 동의, 21:00~08:00 발송은 별도 동의. 주간 계획 리마인더도 기본 발송 시간을 08~21시로 제한」
    - 「추천·보증 심사지침: 경제적 대가가 있는 후기는 표시」
    - 「구독이 있다면 해지를 쉽게(전자상거래법; 미국 ROSCA). FTC Lumos 명령의 핵심 조항이다」

30. **(c) Locales without a regulatory review are still exposed.** In 「나중에 다시 볼 것」, change: 「8개 로케일 시장별 건강 주장 규제(일본 약기법, EU MDR, 동남아): 이번에 조사하지 않았다.」 To: 「…이번에 조사하지 않았다. 따라서 연구 근거 페이지와 스토어 건강 관련 문구는 ko·en만 출시하고, 나머지 6개 로케일은 현지 규제 검토 전까지 메뉴명·면책 문구·게임 설명만 낸다. EU MDR은 면책 문구가 의도된 용도 판단을 뒤집지 않는다」.

31. **(e) Quick Eye geometry cannot be built as written.** With R = min(w,h)/2 − 40dp, a 390dp phone gets R≈155dp. The inner ring (0.4R≈62dp) carries 16 icons of 56dp, about 896dp of icons on a 390dp circumference, and it overlaps the 112dp fixation box (edge at 56dp). Even an iPad inner ring (circumference ≈864dp) overflows.
    - Change: 「표적은 별 모양 아이콘 56dp」 and 「각 링에 16칸」
    - To: 「주변 자극(표적·방해물)은 터치 대상이 아니므로 56dp 하한을 적용하지 않는다. 크기 = min(40dp, 0.8 × 해당 링 둘레/칸 수). 안 링 반경 ≥ 고정 상자 반폭 + 자극 반폭 + 8dp. 폰에서는 안 링을 8칸(방사선만)으로 줄여 최대 방해물 = 8+16+16−1 = 39개로 하고, 47개는 태블릿에서만. 20/70 시력에서 식별 가능한 크기(시거리 40cm 기준 약 ≥ 2.5mm 세부)를 유지한다 [Owsley 2013]」

32. **(e) V15–V18 cannot fit two 72dp icons inside a 112dp box.**
    - Change: 「중앙에 아이콘 2개를 보여 주고 같음/다름을 판단」
    - To: 「중앙에 아이콘 2개(각 48dp, 간격 8dp)를 보여 주고 같음/다름을 판단. 이 단계에서는 고정 상자를 160dp로 넓히고, 안 링 반경을 다시 계산한다」

33. **(e) Fractional L does not say what is actually shown, and the threshold should come from shown time.**
    - Change: 「레벨 L은 0~12 사이 연속값이고, 표시할 때 반올림한다.」 and 「역치 추정값은 마지막 16개 유효 시행의 L 평균을 ms로 바꾼 값이다.」
    - To: 「제시 노출 = 사다리[round(L)]의 ms → 프레임. 매 시행 실제 제시 ms(측정값)를 기록한다. 역치 = 초기 단계 이후 반전점(최소 6개) 실제 ms의 기하평균. 반전점이 6개 미만이면 '추정 불가'로 두고 단계 이동 판단에 쓰지 않는다 [Levitt 1971; Kaernbach 1991]」

34. **(e) The invalid-trial rule cannot catch errors at short exposures.** A 1-frame tolerance on a 1–2 frame stimulus allows 100% error.
    - Change: 「측정한 노출이 목표와 **1프레임 넘게** 어긋나면…무효다.」
    - To: 「목표 프레임 수가 ≤ 6이면 측정 프레임 수가 **정확히 일치**해야 하고, 그 외에는 ±1프레임까지 허용. 어긋나면 무효. 한 세션 무효율이 20%를 넘으면 그 기기의 바닥을 한 칸 올린다(17→33→50ms)」

35. **(e) Refresh-rate measurement and the web floor.** rAF callbacks show when frames were scheduled, not when light actually hit the screen. Variable-refresh displays (ProMotion, Android adaptive, iOS Low Power Mode) change rate in the middle of a session.
    - Change: 「세션 시작 때 rAF 간격 60개의 중앙값으로 화면 주사율을 잰다.」
    - To: 「rAF 간격을 매 시행 직전 20개로 다시 재고, 바뀌면 프레임 수를 다시 계산한다. RN은 고정 주사율을 요청한다(iOS CADisplayLink preferredFrameRateRange, Android Surface.setFrameRate). 웹 바닥도 33ms로 시작하고, 포토다이오드나 고속 촬영으로 확인한 브라우저·기기 조합에서만 17ms를 허용한다 [제품 결정]」

36. **(e) Advancement thresholds would trap most older users.** [2026-11-13: bars now 100/167/200/250/300ms by variant, plus an evidence path (16 valid trials all at or under the bar, ≥14 right) — §2.3 note.] Older-adult UFOV norms for divided and selective attention (subtests 2–3) run roughly 100–350 ms (Edwards 2006 Arch Clin Neuropsychol 21:275-286; original to be checked). Requiring ≤100ms with 47 distractors would leave most 60+ users stuck at V5–V7 for good.
    - Change: 「역치 추정값이 V1에서는 ≤ 50ms, V2~V18에서는 ≤ 100ms이고」
    - To: 「역치 추정값이 V1 ≤ 50ms, V2–V4 ≤ 100ms, V5–V9 ≤ 200ms, V10–V18 ≤ 250ms이고 [제품 결정. UFOV 노인 규준을 참고했고, 출시 후 중앙값으로 조정]」

37. **(e) The mask has photosensitivity risk beyond luminance.** A full-screen high-contrast random pattern can trigger pattern sensitivity even when mean luminance is matched.
    - Change: 「화면 전체에 무작위 패턴을 깐다. 평균 밝기는 자극과 같게 맞춘다.」
    - To: 「자극 영역에만 무작위 패턴을 깐다. 평균 밝기는 자극과 같게, 대비는 낮게(마이클슨 ≤ 0.5), 줄무늬·체커 같은 규칙 패턴은 금지. 출시 전 PEAT 또는 Harding 도구로 2.3.1 일반·적색 섬광 검사를 통과해야 한다」

38. **(e) Sound-off users lose the top variants.**
    - Change: 「V17–V18은 동시 소리 과제 추가(높은 음/낮은 음 판별, 소리 켬 설정일 때만)」
    - To: 「V17–V18은 동시 소리 과제 추가(소리 켬일 때만). 소리 끔이면 V16이 최상위이고, 진행 표시는 '최고 단계 도달'로 한다. 소리 과제 전에 볼륨·청취 확인 화면을 둔다(노인 청력 저하 고려)」

39. **(e) The lives rule does not fit Match Pairs or Number Hunt.** Wrong flips in Match Pairs are part of exploring the board, and Number Hunt (Schulte) is a timed full grid rather than binary trials.
    - Change: the §4.2 row 「속도·다양성 게임 (Odd One Out, Number Hunt, Color Word, Quick Math, Number Pattern, Match Pairs) | 목숨 3개」
    - To: 「Odd One Out, Color Word, Quick Math, Number Pattern: 목숨 3개. Number Hunt: 판 단위. 오탭(정해진 다음 숫자가 아닌 칸)만 목숨 감소, 계단 변수는 판 크기·시간 여유. Match Pairs: 목숨 대신 '이동 수 예산 = 최적 이동 수 × 계수'로 하고, 처음 보는 카드를 뒤집어 틀린 것은 감점하지 않는다 [제품 결정]」

40. **(d/e) The spec does not say how lives interact with the time-boxed slots in 「오늘의 훈련」.** Add to §3/§4.1: 「게임 슬롯은 시간 기준(3~4분). 목숨으로 라운드가 끝나면 남은 시간에 새 라운드를 시작하고, 1분 미만이면 다음 게임으로 넘어간다. 빠른 눈은 최대 4라운드 또는 10분 중 먼저 오는 쪽」.

41. **(a) Mark the 80% target as a product decision.** [2026-11-13: Quick Eye no longer has lives — the 80% target stays as a product decision for continuity, not because of round length. See §4.2 note.]
    - Change: 「목표 정답률 80%. 목숨 모드라서 ACTIVE의 75%보다 높였다.」
    - To: 「목표 정답률 80% [제품 결정: ACTIVE·IHAMS·UFOV는 75%였다. 목숨 모드의 라운드 길이 때문에 올렸고, 원 프로토콜에서 벗어나는 지점이다]」

42. **(b) Add missing references.**
    - Woutersen 2018 is cited in §2.3 but appears in neither list. Add: Woutersen K, et al. (2018). *PLoS One* 13(5):e0196534. doi:10.1371/journal.pone.0196534.
    - Also add Sala 2019, Hill 2017, Bonnechère 2020, Gross 2026 rebuttal and Edwards 2006 norms to the internal list.
    - Change the Gates 2020 citation format from 「CD012277.pub3」 to 「2020;(2):CD012277」.

43. **(d) The visual-field confound and medical framing are missing.** Add to §5: 「녹내장·황반변성 등 시야 손상이 있으면 빠른 눈 주변 과제가 불리하다. 빠른 눈을 '시야 검사'·'눈 건강'으로 표현하지 않고, 성적으로 안과 진료를 권하지 않는다. 설정에서 '중앙 과제만' 모드를 제공한다」.

44. **(d) The A/B test needs ethical guardrails.** Add to §4.5: 「설문(좌절감)은 선택 응답. 결과를 외부에 발표할 계획이면 사전 IRB 심의. A/B 결과는 '효과' 주장 근거로 쓰지 않는다」.

Notes:
- I checked the clear-rate arithmetic in §4.2 and it holds: P(Bin(20, 0.15) ≤ 2) ≈ 40%, and P(Bin(30, 0.2) ≤ 4) ≈ 25%.
- I did not run web checks for this review. The Edwards 2006 norm figures in items 31 and 36 are approximate and should be checked against the original before the thresholds are fixed.

---

## 부록 C. 교차검증된 연구 결과(원자료)

### rct-speed-training
- (rct-speed-training #0) [verified] Coe NB 2026 "Impact of cognitive training on claims-based diagnosed dementia over 20 years: evidence from the ACTIVE study" Alzheimer's & Dementia: Translational Research & Clinical Interventions 12(1):e70197 https://doi.org/10.1002/trc2.70197
  claim: Over 20 years of Medicare claims, the only significant reduction in diagnosed dementia in ACTIVE was in the speed-of-processing arm, and only among people who were randomized to booster sessions. The headline intention-to-treat comparison of each arm against control was NOT significant for any arm, speed included.
  numbers: N=2,021 (traditional Medicare at baseline; 725 Medicare Advantage enrollees excluded), 1999-2019. Diagnosed ADRD (CCW algorithm, about 85-90% sensitivity/specificity): control 239/491 (48.7%). Full arms, adjusted HR vs control: speed 0.87 (0.72-1.05), memory 0.85 (0.70-1.02), reasoning 0.88 (0.73-1.07), all NS. Speed+booster 105/264 (39.8%), adj HR 0.75 (0.59-0.95). Speed without booster 92/201 (45.8%), HR 1.01 (0.81-1.27). Speed booster vs no-booster within arm: HR 0.81 (0.66-1.00). Reasoning+booster: unadjusted 0.79 (0.63-0.98), adjusted 0.83 (0.66-1.04). Speed participants who did fewer than 8 of 10 sessions: 26/47 (55.3%). Boosters: up to 4x75 min at 11 and 35 months, offered only to people who completed at least 8/10 initial sessions. 77% of participants died during follow-up. The AsPredicted #67523 preregistration 'inadvertently omitted' the booster analyses. Disclosure: Ball owns stock in Posit Science, which sells the training.
  quality: Secondary analysis of a 4-arm single-blind RCT (N=2,802) linked to claims. The significant result is a post-randomization, booster-conditioned subgroup that was not in the preregistration. Main ITT effects are null.
  implication: The only game type with any RCT dementia signal is adaptive speed-of-processing training. Of our 8 games, none currently matches it, so a 'speed vision' game should be added (see the mechanics findings). The signal depended on repeated boosters, so build a structured course: an initial block, then booster blocks at about 11 and 35 months with in-app reminders, not just endless play. Copy must not say '치매 예방' or '치매 위험 25% 감소'. An honest line would be: '미국 ACTIVE 연구에서 쓰인 처리속도 훈련 방식을 참고했습니다. 이 앱이 치매를 예방한다는 근거는 없습니다.'
- (rct-speed-training #1) [verified] Dickens WT 2026 "Reanalyzing the impact of cognitive training over 20 years in the ACTIVE study: Losing the forest in the trees (with author response: Gross AL, Rebok GW, Albert MS, doi:10.1002/trc2.70290)" Alzheimer's & Dementia: Translational Research & Clinical Interventions 12(2):e70280 https://doi.org/10.1002/trc2.70280 (PMID 42339399)
  claim: An independent reanalysis argues that after multiplicity correction no ACTIVE 20-year hazard ratio is significant. It also argues that the pattern points to a small common effect of all three training types, concentrated in the youngest participants. The trial authors reject the need for correction because the arms were separate prespecified hypotheses.
  numbers: After Bonferroni-Dunn correction of the six Table 2 HRs, all CIs include 1. Sign tests reject both 'no training effect' and 'only one training type works'. GMM modeling suggests a common protective effect across all treatments, concentrated at ages 65-69 (published age-stratified HRs: memory 0.69 [0.46-1.02], reasoning 0.77, speed 0.83).
  quality: Peer-reviewed commentary/reanalysis of published summary statistics, with a published rebuttal. This is an expert disagreement, not new data.
  implication: Treat the 20-year 'speed + booster' result as contested, and never quote the 0.75 HR as an established effect in store listings or push copy. In internal docs, describe the evidence as 'promising but disputed'. Keep the other game types (memory, reasoning, Stroop and so on) as legitimate cognitive stimulation. Do not frame them as useless or as proven.
- (rct-speed-training #2) [verified] Edwards JD 2017 "Speed of processing training results in lower risk of dementia" Alzheimer's & Dementia: Translational Research & Clinical Interventions 3(4):603-611 https://doi.org/10.1016/j.trci.2017.09.002 (PMID 29201994, PMC5700828)
  claim: In the 10-year ACTIVE analysis, randomization to speed training was associated with lower algorithm-defined dementia. Memory and reasoning were not. Each additional speed session completed was associated with about 10% lower hazard, a dose-response that holds within booster-eligible subgroups but could reflect reverse causality.
  numbers: Analytic N=2,785, 260 dementia cases. Speed HR 0.71 (0.50-0.998), P=.049. Memory 0.79 (0.57-1.11), reasoning 0.79 (0.56-1.10), both NS. Per extra speed session: HR 0.90 (0.85-0.95), adjusted 0.90. Among 639 completers of at least 8 sessions: 0.89 (0.82-0.98). Among 365 booster-randomized: 0.83 (0.74-0.92). Five or more booster sessions: 5.9% dementia (speed) vs 9.7-10.1% (memory/reasoning boosters). Sensitivity HR range 0.64-0.87. Dose range 0-18 sessions. Raw cumulative incidence is 59/698=8.5% speed vs 75/695=10.8% control. The paper's '22.7% vs 28.8%' are shares of cases by arm, not risks. Dementia was defined by algorithm (psychometric + IADL impairment, MMSE <22, or self/proxy-reported diagnosis), not clinical diagnosis. Attrition 30.6%.
  quality: Secondary analysis of RCT (ACTIVE was not designed with dementia as an outcome). Borderline P=.049, non-clinical outcome definition, and an observational dose-response.
  implication: Count completed training sessions and minutes per user, and surface them as the progress metric ('완료한 훈련 세션 7/10') rather than streaks or high scores, since dose is the variable linked to the outcome. Never present the per-session 10% figure as a promise. If cited at all, use raw numbers (8.5% vs 10.8% over 10 years) and not the misleading 22.7% vs 28.8%.
- (rct-speed-training #3) [verified] Unverzagt FW 2012 "ACTIVE cognitive training and rates of incident dementia" Journal of the International Neuropsychological Society 18(4):669-677 https://doi.org/10.1017/S1355617711001470 (PMID 22400989)
  claim: At 5 years of follow-up, ACTIVE cognitive training (any arm) was not associated with lower incident dementia.
  numbers: N=2,802; 189 incident dementia cases over 5 years. Training group was not associated with dementia rate in a multivariable model.
  quality: Secondary analysis of RCT. A null result that preceded the positive 10-year reanalysis.
  implication: Any benefit, if real, emerges only over a decade or more and with continued dosing. Do not imply short-term protection in onboarding or results screens (for example, after 2 weeks of play). Frame in-app gains as 'game performance improved', not 'brain protected'.
- (rct-speed-training #4) [verified] Ball K 2002 "Effects of cognitive training interventions with older adults: a randomized controlled trial" JAMA 288(18):2271-2281 https://doi.org/10.1001/jama.288.18.2271 (PMID 12425704, PMC2916176)
  claim: ACTIVE delivered 10 small-group sessions per arm. Speed training was computer-based, adaptive and criterion-driven, while memory and reasoning were strategy instruction. Speed produced by far the largest and most reliable near-transfer gains, boosted further by booster training. No everyday-function effect appeared at 2 years.
  numbers: N=2,832 aged 65-94 (2,802 analyzed). Arms: memory 711, reasoning 705, speed 712, control 704. Ten sessions of 60-75 min over 5-6 weeks. Booster: 4x75 min over 2-3 weeks at 11 months for a 60% random sample of completers. Reliable improvement immediately after training: speed 87%, reasoning 74%, memory 26%. With booster: speed 92% vs 68%, reasoning 72% vs 49%. Speed immediate effect size about 1.46. 89% completed at least 8 sessions. Speed difficulty was raised by shorter duration, added visual/auditory distraction, more concurrent tasks or wider spatial spread, each time a criterion was met. Memory = mnemonic strategies (categorizing, imagery, association). Reasoning = serial-pattern strategies (letter/number series, dosing schedules).
  quality: Large multisite single-blind RCT; primary outcome publication.
  implication: Number Pattern (series completion) is essentially the ACTIVE reasoning arm. It is a good game, but it had no dementia effect, so do not label it as dementia-related. Match Pairs, Sequence and Flash Grid are closest to memory training (also null). For the speed game, follow the ACTIVE rule: raise difficulty only after the user meets a criterion on the current task, using four dials (shorter exposure, distractors, a second concurrent task, wider spread).
- (rct-speed-training #5) [verified] Rebok GW 2014 "Ten-year effects of the Advanced Cognitive Training for Independent and Vital Elderly cognitive training trial on cognition and everyday functioning in older adults" Journal of the American Geriatrics Society 62(1):16-24 https://doi.org/10.1111/jgs.12607 (PMID 24417410, PMC4055506)
  claim: At 10 years, speed and reasoning (not memory) training still improved their targeted abilities. All three arms reported less IADL difficulty than controls, and boosters added durable gains for speed and reasoning.
  numbers: N=2,832, mean baseline age 73.6, 26% African American. 10-year targeted-ability effect sizes: speed 0.66 (99% CI 0.43-0.88), reasoning 0.23 (0.09-0.38), memory not maintained. Booster added speed 0.62 (0.31-0.93) and reasoning 0.21 (0.01-0.41). Self-reported IADL effect sizes: memory 0.48, reasoning 0.38, speed 0.36. About 60% of trained vs 50% of controls at or above baseline IADL at 10 years.
  quality: 10-year follow-up of RCT. Cognitive outcomes objective, IADL self-reported, substantial attrition.
  implication: Defensible copy is about trained skills and everyday functioning, for example '연구에서 이런 유형의 훈련은 10년 뒤에도 처리속도 향상이 유지됐습니다', not dementia. Keep boosters in the product plan because the strongest durable effects came from boosted participants.
- (rct-speed-training #6) [verified] Ball KK 2013 "Speed of processing training in the ACTIVE study: how much is needed and who benefits?" Journal of Aging and Health 25(8 Suppl):65S-84S https://doi.org/10.1177/0898264312470167 (PMID 24385640, PMC3947605)
  claim: ACTIVE speed-of-processing training (SOPT) is a nonverbal, trainer-guided, adaptive set of UFOV-like tasks. It has at least 18 variants, display duration is the primary manipulation, and the target is a stable ~75% correct. Each booster session was associated with offsetting months of age-related slowing.
  numbers: Outcome test: 4 UFOV subtests, display 16-500 ms, 75% threshold by double staircase. (1) central target identification; (2) plus peripheral target at 12.5 cm eccentricity, one of 8 radial positions; (3) plus distractors; (4) central same/different discrimination plus peripheral localization with distractors. Training: groups of 2-4 with a certified trainer; center task made easier (detection) or harder (discrimination plus a concurrent auditory task); sessions 1-5 standardized, sessions 5-10 customized to hold about 75% correct. 702 randomized to speed, 633 (90.2%) booster-eligible, 365 randomized to booster. Full attendance: 75.9% did all 4 boosters at year 1, 60.0% at year 3. One booster session offset 4.92 months of processing-speed decline. All 10 initial + 8 booster sessions gave about 2.5 SD predicted UFOV improvement.
  quality: Treatment-received and ITT latent growth analyses within an RCT arm. Dose estimates are partly observational. Author has a commercial interest (Posit Science).
  implication: Speed game blueprint: (a) a central identification task alone; (b) the same plus peripheral localization at 8 radial positions; (c) plus distractors; (d) a harder central task (same/different, or a concurrent tone task). Adapt exposure time at each stage to hold about 75% correct; our weighted up-down rule converging near 73% is already appropriate. Give minimal strategy instruction, since the training was implicit practice. Expect booster attendance to decay (76% to 60%), so make booster reminders gentle and repeated.
- (rct-speed-training #7) [verified] Owsley C 2013 "Visual processing speed" Vision Research 90:52-56 https://doi.org/10.1016/j.visres.2012.11.014 (PMID 23231958, PMC3615057)
  claim: The standard UFOV test (on which the training is built) measures the shortest exposure at which a car-vs-truck central target, alone or with a peripheral target among distractors, is reported correctly 75% of the time. Thresholds range from one 60 Hz frame (16.67 ms) to 500 ms.
  numbers: PC UFOV thresholds 16.67-500 ms at 75% correct. Peripheral targets at about 10 degrees on 8 radial directions. Subtest 4 uses harder central discrimination. Takes 15 min or less. Original version: 16.67-250 ms, peripheral at 10/20/30 degrees, targets legible down to 20/70 acuity. Complementary specs from Woutersen K et al. 2018, PLoS One 13:e0196534 (doi:10.1371/journal.pone.0196534): car/truck 1.7x1.1 degrees inside a 2.9-degree white fixation box, peripheral car at 13.7 degrees, distractors in 3 rings at 4.6/9.1/13.7 degrees, at least 4 practice trials per subtest.
  quality: Narrative review by a test developer plus a methods-detailed normative study. These describe measurement, not efficacy.
  implication: Use frame-counted exposure (requestAnimationFrame), not setTimeout. Exposure steps are quantized to 16.7 ms at 60 Hz (8.3 ms at 120 Hz), so define the ladder in frames, for example from 30 frames (500 ms) down to 1 frame. Use high-contrast, large icons legible at 20/70 for older users. On phones, the peripheral ring cannot reach 10-14 degrees of visual angle at normal viewing distance, so place peripheral targets near the screen edge, prefer tablet/landscape, and treat the phone version as untested.
- (rct-speed-training #8) [corrected] Edwards JD 2018 "Systematic review and meta-analyses of useful field of view cognitive training" Neuroscience & Biobehavioral Reviews 84:72-91 https://doi.org/10.1016/j.neubiorev.2017.11.004 (PMID 29175362)
  claim: In a meta-analysis of UFOV training, adaptive versions produced larger near-transfer gains than partially or non-adaptive versions. Effects were smaller in clinical samples, there was no transfer to other neuropsychological tests, and there were benefits for driving and well-being.
  numbers: 44 studies from 17 RCTs. Training = 18 visual tasks across 10 display-speed levels, identifying and localizing white car/truck targets with or without distractors (visual triangles or auditory tone sweeps). Typically 10 one-hour sessions, up to 30 h. Adaptive d=0.89 vs partially adaptive d=0.75 on the UFOV outcome. Wadley: adaptive 1.35x more efficacious. Active-control comparisons d=0.77, no-contact d=0.63. Community samples d=0.85 vs clinical d=0.33. Adverse driving events OR 0.50. Well-being d=0.21. ACTIVE structure: 5 non-adaptive + 5 adaptive initial sessions, plus up to 8 adaptive booster sessions. First author was a Posit Science consultant in 2007.
  quality: Systematic review and meta-analysis (small k per moderator, high heterogeneity I2 83-90%). Conducted by the UFOV research group.
  implication: Use a 10-level exposure ladder times task-variant matrix (about 18 variants) and keep it adaptive. Include an optional auditory distractor or dual task at top levels. Expect weaker gains for users with existing impairment (clinical d=0.33), and do not target MCI/dementia users with efficacy claims. The near-transfer result means in-game score gains will not transfer to 'memory' in general, so say so.
  CHECKER: Bibliographic details are right: Neurosci Biobehav Rev 2018;84:72-91, 44 studies from 17 RCTs, 33 of them meta-analysed. A companion GSA 2018 abstract confirms several numbers: adaptive d=0.89, community samples d=0.85, adverse driving events OR=0.50 over 3-10 years, well-being d=0.21, IADL d=0.27, overall UFOV outcome d=0.71. What needs fixing: the claim 'no transfer to other neuropsychological tests' is too strong. The review reports that UFOV training improved speed-of-processing measures (d=0.22) and attention (d=0.14). It found no transfer only for memory, executive function and reaction time. The abstract also calls effects 'equivalent' against active and no-contact controls. The full text is paywalled, so these could not be checked: partially adaptive d=0.75, clinical d=0.33, active vs no-contact d=0.77/0.63, the Wadley 1.35x figure, the 18 tasks x 10 speed levels description, the 5 non-adaptive + 5 adaptive ACTIVE structure, and the 2007 Posit consultancy. (https://academic.oup.com/innovateage/article/2/suppl_1/680/5169965)
- (rct-speed-training #9) [corrected] Wolinsky FD 2013 "A randomized controlled trial of cognitive training using a visual speed of processing intervention in middle aged and older adults (IHAMS)" PLoS One 8(5):e61624 https://doi.org/10.1371/journal.pone.0061624 (PMID 23650501, PMC3641082; NCT01165463)
  claim: An independent RCT with an attention-control (crosswords) showed that 10 h of a commercial UFOV-derived game ('Road Tour', now BrainHQ Double Decision) improved processing-speed tests in adults aged 50+. This included a self-administered at-home arm, and the gains held at one year.
  numbers: N=681 (620 analyzed, 91%), ages 50-64 and 65+. Arms: 10 h on-site; 14 h on-site (10 h + 2x2 h booster at 11 months); 10 h at-home on own PC; vs 10 h computerized crosswords. On-site delivery was 5 weekly 2-h sessions. 1-year UFOV d -0.322 to -0.579 (3.0-4.1 'years of protection'), with gains on Trails A/B, SDMT and Stroop Word. Task: masked frame, then car or truck at center and 8 circular positions (7 distractor signs + 1 Route 66 target), then the user picks the vehicle and then the target location. Advances only at a sustained 75% success. Harder levels add medium and distal orbits, up to 47 distractors, and vehicle pairs that morph through 9 similarity stages. ACTIVE 1-year UFOV gain: 220.5 ms vs 69.9 ms in controls. No dementia outcome was measured.
  quality: RCT with active control, outcome assessors blinded at baseline only. Cognitive-test outcomes, no dementia endpoint.
  implication: This is the most directly implementable spec. Show a center 'car vs truck' style pair (use culturally neutral icons with 9 similarity stages) and 8 positions with 1 target among distractors. The user answers center first, then location. Progression: exposure shortening, then middle/outer rings, then more distractors (up to about 47), then more similar center pairs, each advancing only at about 75%. Self-paced home use worked, which supports offering it in-app to adults 50+. Avoid the trademarks UFOV and Double Decision in the UI or marketing.
  CHECKER: All the numbers and task details check out: N=681, 620 analysed (91%); on-site training as 5 weekly 2-h sessions; 2x2-h boosters at 11 months; at-home 10 h; UFOV d -0.322 to -0.579 (3.0-4.1 years); Route 66 sign with 7 distractors; vehicle chosen first, then location; 75% rule; up to 47 distractors; 9 morph stages; 220.5 vs 69.9 ms. Calling the trial 'independent' overstates it. The PI (Wolinsky) was a co-investigator on ACTIVE and consulted part-time for Posit Science from Dec 2007 to Mar 2009. Posit built the Road Tour game with Ball and Roenker. The paper still declares no competing interests. Smaller points: '(IHAMS)' is not part of the official title. 'Now BrainHQ Double Decision' is not stated in the paper. Not every arm was significant on every secondary outcome: in Table 2, Trails A for the booster arm (-0.204) and Trails B for the on-site arm (-0.225) have CIs that cross 0. (https://pmc.ncbi.nlm.nih.gov/articles/PMC3641082/)
- (rct-speed-training #10) [verified] Lampit A 2014 "Computerized cognitive training in cognitively healthy older adults: a systematic review and meta-analysis of effect modifiers" PLoS Medicine 11(11):e1001756 https://doi.org/10.1371/journal.pmed.1001756 (PMID 25405755)
  claim: Across RCTs in cognitively healthy older adults, computerized cognitive training has a small overall effect. Design matters: unsupervised home-based training and more than 3 sessions per week were ineffective, and sessions under 30 minutes had only weak evidence.
  numbers: 52 RCTs, 4,885 participants. Overall g=0.22 (0.15-0.29). Processing speed g=0.31, visuospatial 0.30, nonverbal memory 0.24, working memory 0.22, verbal memory 0.08. Executive function and attention NS. No evidence for working-memory training. Home-based ineffective vs group-based. More than 3 sessions/week ineffective vs 3 or fewer. Weak evidence for sessions under 30 min.
  quality: Systematic review and meta-analysis of RCTs. Moderator findings are observational across trials.
  implication: Recommend 2-3 sessions per week of about 30-60 minutes over 5-6 weeks, as ACTIVE did (10 x 60-75 min), rather than daily 2-minute endless play. Make 'today's session' a bounded block (for example 20-30 min across several games) with a clear end screen. Consider social or supervised features such as family check-ins, since unsupervised home use is the weakest format.
- (rct-speed-training #11) [verified] Gates NJ 2019 "Computerised cognitive training for preventing dementia in people with mild cognitive impairment" Cochrane Database of Systematic Reviews 2019(3):CD012279 https://doi.org/10.1002/14651858.CD012279.pub2 (PMID 30864747)
  claim: A Cochrane review found that no RCT of computerized cognitive training in mild cognitive impairment reported incident dementia, and evidence on cognition was very low quality.
  numbers: 8 RCTs, 660 participants, at least 12 weeks of training (12 weeks to 18 months). 'No trial provided data on incident dementia.' Speed of processing SMD 0.20 (-0.16 to 0.56), low-quality evidence. Most other outcomes very low quality. Companion review in cognitively healthy adults (Gates 2020, CD012277): 8 RCTs, 1,183 participants, evidence low or very low.
  quality: Cochrane systematic review, GRADE very low to low certainty.
  implication: There is zero RCT evidence that any app-style training delays conversion from MCI to dementia. Do not market to people with MCI or dementia as treatment. If a user self-reports memory problems, the copy should point them to a doctor or a local 치매안심센터 rather than to more games.
- (rct-speed-training #12) [verified] Devanand DP 2022 "Computerized Games versus Crosswords Training in Mild Cognitive Impairment" NEJM Evidence 1(12) https://doi.org/10.1056/EVIDoa2200121 (PMID 37635843; NCT03205709)
  claim: In MCI, home-based web cognitive games (Lumosity-type) were outperformed by web crossword puzzles on the primary cognitive outcome over 78 weeks. A separate RCT of 40 h of 'brain-plasticity' training in amnestic MCI did not beat ordinary computer games.
  numbers: N=107 MCI (51 games, 56 crosswords). 12 weeks intensive + 6 boosters, 78-week follow-up. ADAS-Cog LS mean difference -1.44 (95% CI -2.83 to -0.06), P=0.04, favoring crosswords: games 9.53 to 9.93 (worse), crosswords 9.59 to 8.61 (better). FAQ function worse with games (-1.08; -1.97 to -0.18). Also Duff K et al. 2022, J Geriatr Psychiatry Neurol 35(3):400-409 (doi:10.1177/08919887211006472): 113 aMCI, 40 h plasticity-based CCT; computer-game controls did better right after training (p=0.02), no difference at 1 year.
  quality: Two small RCTs in MCI with active controls. Single trials with modest effects and secondary MRI findings.
  implication: Commercial-style mini-games are not shown to beat simple word puzzles in impaired users. ReeeeecallStudy's core flashcard/word activity may be as valuable as the brain-training games, so position the games as one form of cognitive stimulation alongside study, not as superior medicine. Avoid comparative claims ('크로스워드보다 효과적').
- (rct-speed-training #13) [corrected] Owen AM 2010 "Putting brain training to the test" Nature 465(7299):775-778 https://doi.org/10.1038/nature09042 (PMID 20407435, PMC2884087)
  claim: The largest online brain-training trial found improvements on the trained tasks but no transfer to untrained cognitive tests, even closely related ones. Short, frequent, gamified sessions were the 'failed' design pattern.
  numbers: 52,617 registered and 11,430 completed (ages 18-60). At least 10 min/day, 3 times a week, for 6 weeks. Mean 24.47 sessions (SD 16.95). Between-group effect sizes on benchmark tests 0.01 to 0.22. The control group (answering obscure questions online) improved similarly.
  quality: Large online RCT, but in younger and middle-aged adults (not 65+). High dropout. Not a dementia study.
  implication: Rising game levels prove only game-specific learning. Results screens should say '이 게임 실력이 늘었어요' and must not convert scores into 'brain age' or 'memory improved X%'. Endless 10-minute play without dosing structure matches the null design, which is another reason to add bounded sessions and courses.
  CHECKER: All the numbers are right: 52,617 registered and 11,430 completed (ages 18-60); at least 10 min a day, 3 times a week, for 6 weeks; mean 24.47 sessions (SD 16.95); between-group effect sizes 0.01 to 0.22; controls answered obscure questions and improved similarly; no transfer even to closely related tasks. The sentence 'Short, frequent, gamified sessions were the failed design pattern' is the finding's own interpretation, not the paper's. Every arm followed the same schedule, so the trial could not test session format as a cause. The paper blames the lack of transfer, not the session design, and never calls the tasks 'gamified'. Drop that sentence or label it as inference. (https://pmc.ncbi.nlm.nih.gov/articles/PMC2884087/)
- (rct-speed-training #14) [verified] World Health Organization 2026 "Risk reduction of cognitive decline and dementia: WHO guidelines, second edition" WHO guideline (ISBN 978-92-4-012355-7), released July 2026 https://www.who.int/publications/i/item/9789240123557
  claim: WHO's 2026 dementia risk-reduction guideline keeps only a conditional, low-certainty recommendation that cognitive training 'may be offered'. It notes little to no effect on dementia incidence at 5 years and says the optimal type, frequency, intensity and duration are unknown. It newly adds that cognitive stimulation, including playing games, 'may be encouraged' (very low certainty).
  numbers: 'To reduce the risk of cognitive decline and/or dementia specifically, cognitive training may be offered to older adults with normal cognition or mild cognitive impairment.' Conditional, certainty low (upgraded from very low in 2019). Evidence: small improvement in cognitive function (Hedges g 0.25, follow-up 1-48 weeks), 'little to no effect on dementia incidence after 5 years of follow-up (HR 1.00)'. New rec: 'engagement in cognitive stimulation may be encouraged' (conditional, very low certainty). 'Evidence is insufficient to determine the optimal type, frequency, intensity and duration of cognitive training.'
  quality: International GRADE-based guideline, low to very low certainty.
  implication: This is the safest anchor for copy, in Korean and the other 7 locales: '세계보건기구(WHO)는 인지 훈련을 인지 저하 위험을 줄이기 위한 선택지로 «제안할 수 있다»고 봅니다(근거 수준 낮음).' Never say 'WHO 권장 치매 예방 게임'. Pair the games with WHO's stronger levers (physical activity, hearing, blood pressure, social activity) in a short info card instead of implying the games alone protect.
Open questions: PACT trial (NCT03848312, University of South Florida): N=7,600, 45 computerized speed-training sessions vs computerized cognitive stimulation, primary outcome clinically diagnosed incident MCI or dementia at 3 years. Status: active, not recruiting; primary completion estimated 2028-01-31. This is the first trial powered for a clinical dementia/MCI endpoint. Any dementia-related claim should wait for it. | The ACTIVE 20-year speed+booster effect rests on a booster-conditioned subgroup that was not in the preregistration (AsPredicted #67523), and it is disputed under multiplicity correction (Dickens 2026). Independent replication with a dementia endpoint does not exist yet. | Exact ACTIVE trainer-manual parameters were not found in openly accessible primary sources: the ms ladder per level, step sizes, trials per block, post-stimulus mask type and duration, and auditory-task specifics. Jobe et al. 2001 (Controlled Clinical Trials 22:453-479, PMC2916177) is PDF-only. One secondary description (Millisecond Inquisit) cites a 500 ms post-mask, but I could not verify that in a primary source. | Lives/round-ending: no trial evidence was found on miss-limited rounds. At the 75% threshold used by UFOV/ACTIVE/IHAMS, about 1 in 4 trials is a miss by design, so a fixed '3 misses = game over' would end rounds after about 12 trials. That is too short for a staircase to converge. A design to test: count lives only for consecutive misses, or size the miss budget to the block length (for example a 30-trial block with 8-10 allowed misses). Whether this affects adherence in older adults is unknown. | Phone delivery is untested. The trials used desktop monitors or touch screens with the peripheral ring at about 10-14 degrees of visual angle. Whether a phone-sized display (smaller visual angle) preserves the training effect is unknown, and tablet/landscape is the closer match. | Unsupervised home training: Lampit 2014 finds home-based CCT ineffective, while the IHAMS at-home arm improved UFOV. Whether the app format (unsupervised, short, mobile) reproduces ACTIVE-style effects has not been tested. | No Korean or other East Asian RCT of speed-of-processing training with a dementia or MCI-conversion endpoint was identified in this search. Applicability to Korean older adults, and copy constraints under Korean medical-device and advertising rules, need separate review. | WHO 2026 cites 'HR 1.00 for dementia at 5 years' from its review reference (26) and does not appear to weigh the ACTIVE 20-year Medicare analysis. Which trials drive that pooled estimate was not checked. | Commercial and IP caution: UFOV is a registered trademark of the Visual Awareness Research Group, and Road Tour/Double Decision are Posit Science products. Several ACTIVE/UFOV authors (Ball, Edwards) have or had Posit Science ties. A generic re-implementation should avoid these names and should not imply equivalence to the tested product.

### reviews-guidelines
- (reviews-guidelines #0) [verified] World Health Organization (Guideline Development Group) 2026 "Risk reduction of cognitive decline and dementia: WHO guidelines, second edition" World Health Organization, Geneva (ISBN 978-92-4-012355-7); 1st edition 2019 ISBN 978-92-4-155054-3 https://www.who.int/publications/i/item/9789240123557 ; https://www.ncbi.nlm.nih.gov/books/NBK623908/
  claim: The current WHO guideline (2nd ed., July 2026) keeps cognitive training as a CONDITIONAL recommendation with LOW certainty. In 2019 the certainty was very low to low, so it was upgraded by one step and stayed conditional. WHO's pooled evidence shows a small short-term gain in cognitive test scores and no effect on dementia incidence. WHO added a new conditional recommendation (very low certainty) for 'cognitive stimulation', which includes everyday games and reading.
  numbers: Cognitive training: 'may be offered to older adults with normal cognition or MCI'. Conditional, certainty LOW (2019 edition: very low to low). Cognitive training gave a small improvement in cognitive function, Hedges' g 0.25 (follow-up 1-48 weeks), and had 'little to no effect on dementia incidence after 5 years' (HR 1.00). Cognitive stimulation: 'may be encouraged'. Conditional, certainty VERY LOW. Observational studies of stimulating activities: RR 0.69-0.95. WHO verbatim: 'the evidence is insufficient to determine the optimal type, frequency, intensity and duration of cognitive training'. On delivery: 'mobile applications and online training platforms offer scalable and cost-effective delivery options... However, digital literacy and equitable access must be addressed.'
  quality: International guideline, GRADE. Built on 7 systematic reviews. Conditional recommendation, low / very-low certainty.
  implication: Honest framing the app can use: 'WHO 2026 지침은 인지훈련을 조건부로 권고합니다(근거 확실성 낮음). 치매를 예방한다는 근거는 아직 없습니다.' Present the feature as cognitive stimulation and training (두뇌 자극 활동), not as a 치매 예방 프로그램. WHO names digital literacy as a requirement. So give each game a practice round without lives, large tap targets, and both text and visual instructions in all 8 locales.
- (reviews-guidelines #1) [verified] World Health Organization (Guideline Development Group) 2026 "Risk reduction of cognitive decline and dementia: WHO guidelines, second edition, section 3.4.1 Multidomain interventions" World Health Organization, Geneva https://www.who.int/publications/i/item/9789240123557
  claim: The new WHO multidomain recommendation has the highest certainty in the guideline, and even its effects are trivial. Combining 3 or more risk factors (exercise, diet, cognitive training, vascular monitoring, social) is conditionally recommended at moderate to high certainty. In cognitively healthy people it showed little or no effect on incident dementia and only trivial cognitive gains.
  numbers: 'tailored, multidomain interventions may be offered'. Conditional, certainty MODERATE TO HIGH. De novo meta-analysis of 44 RCTs (2012-2025). Healthy or at-risk adults: high certainty of 'little or no effect on incident dementia', with consistent but trivial cognitive effects (SMD 0.01-0.08). MCI or prodromal AD: SMD 0.00-0.18. No effect on CDR sum of boxes (high certainty).
  quality: WHO GRADE on a de novo SR/MA of 44 RCTs. Conditional recommendation, moderate-to-high certainty.
  implication: Brain games are the weakest leg of prevention, and even the strongest approach (multidomain) gives very small effects. Put the 8 games inside a broader '두뇌 건강 습관' screen with simple weekly check-ins: walking 3+ times a week, social contact, blood-pressure and hearing checks. Never present the games as the prevention strategy on their own.
- (reviews-guidelines #2) [verified] Gates NJ 2020 "Computerised cognitive training for 12 or more weeks for maintaining cognitive function in cognitively healthy people in late life" Cochrane Database of Systematic Reviews 2020, Issue 2, CD012277.pub3 https://doi.org/10.1002/14651858.CD012277.pub3
  claim: Cochrane review of cognitively healthy adults aged 65+: 12 or more weeks of computerised cognitive training (CCT) may give a small immediate benefit on global cognition compared with active controls (low-quality evidence). The benefit did not persist at 12 months.
  numbers: 8 RCTs, n=1,183, interventions of 12-26 weeks. Global cognition vs active control at 12 weeks: SMD -0.31 (95% CI -0.57 to -0.05), favouring CCT; 2 studies, n=232; low quality. At 12-month follow-up: SMD -0.21 (-0.66 to 0.24); 1 study, n=77; no persistence. Episodic memory vs active control: SMD 0.06 (-0.14 to 0.26). Working memory: SMD -0.17 (-0.36 to 0.02). Processing speed and executive function: very low quality.
  quality: Cochrane systematic review. Low to very low GRADE certainty.
  implication: Any benefit is small, short-lived and depends on ongoing practice. Copy must not say '효과가 오래 지속' and must not show a '뇌 나이' or 'brain improved X%' score. Reward consistency (sessions per week) rather than one-off high scores.
- (reviews-guidelines #3) [verified] Gates NJ 2019 "Computerised cognitive training for preventing dementia in people with mild cognitive impairment" Cochrane Database of Systematic Reviews 2019, CD012279.pub2 (PMID 30864747) https://doi.org/10.1002/14651858.CD012279.pub2 ; contrast: Hill NT et al. Am J Psychiatry 2017, https://doi.org/10.1176/appi.ajp.2016.16030360
  claim: In people with MCI, the Cochrane review found the evidence too weak to say whether CCT prevents dementia or maintains cognition. No trial reported incident dementia. A non-Cochrane meta-analysis found moderate effects on test scores in MCI.
  numbers: Cochrane: 8 RCTs, n=660, 12 weeks to 18 months. Global cognition: very-low-quality evidence. Processing speed: SMD 0.20 (-0.16 to 0.56). Verbal fluency: SMD -0.16 (-0.76 to 0.44). No incident-dementia data. Hill 2017: 17 MCI trials, overall cognition Hedges' g 0.35 (0.20-0.51). In dementia, g 0.26 (0.01-0.52), driven by VR/Wii trials.
  quality: Cochrane SR, very low certainty. Hill 2017 is a meta-analysis without GRADE.
  implication: Do not market the games to people with MCI or dementia as treatment. In Korea that is regulated digital-therapeutic territory (see the regulatory finding). If a user reports memory worries, point them to 치매안심센터 or 보건소 screening instead of more games.
- (reviews-guidelines #4) [verified] National Academies of Sciences, Engineering, and Medicine (Leshner AI, chair) 2017 "Preventing Cognitive Decline and Dementia: A Way Forward" The National Academies Press, Washington DC; underlying AHRQ review: Butler M et al., Ann Intern Med 2018;168:63-68 https://doi.org/10.17226/24782 ; https://doi.org/10.7326/M17-1531
  claim: The US National Academies judged cognitive training to have 'encouraging but inconclusive' evidence for delaying or slowing age-related cognitive decline. They found no evidence that it prevents MCI or dementia, and no evidence that commercial brain-training apps give long-term benefits. The AHRQ review behind the report found gains only in the trained domain.
  numbers: Three intervention classes rated 'encouraging, although inconclusive': cognitive training, BP management in hypertension, and physical activity. 'There is no evidence at this time to support a conclusion that cognitive training can prevent or delay MCI or CATD.' 'no evidence... that these kinds of beneficial long-term cognitive effects are obtained with commercial, computer-based brain training applications, which appear to have short-term benefits that apply only to the specific cognitive task that is rehearsed.' The positive signal rested 'largely on a single, long-duration clinical trial' (ACTIVE). Butler 2018: 11 low/medium risk-of-bias trials. In healthy older adults, training improved the trained domain but not others (moderate strength). Prevention evidence: insufficient.
  quality: National consensus report built on an AHRQ systematic review (strength-of-evidence grading).
  implication: Allowed copy: '인지훈련이 나이에 따른 인지 저하를 늦추는 데 도움이 될 수 있다는 유망하지만 결론나지 않은 근거가 있습니다.' Forbidden: anything saying the games prevent MCI or dementia, or implying the app inherits ACTIVE trial results.
- (reviews-guidelines #5) [verified] Lampit A 2014 "Computerized cognitive training in cognitively healthy older adults: a systematic review and meta-analysis of effect modifiers" PLoS Medicine 11(11):e1001756 (PMID 25405755) https://doi.org/10.1371/journal.pmed.1001756 ; also Bonnechère B et al. Sci Rep 2020, https://doi.org/10.1038/s41598-020-72281-3
  claim: Meta-analyses of CCT in healthy older adults show small effects that differ by domain. Processing speed responds most consistently. Design choices (supervision, frequency) affect efficacy, and unsupervised home training and more than 3 sessions a week came out ineffective.
  numbers: Lampit 2014: 52 RCTs, n=4,885. Overall g=0.22 (0.15-0.29). By domain: processing speed g=0.31 (0.11-0.50); visuospatial 0.30 (0.07-0.54); nonverbal memory 0.24 (0.09-0.38); working memory 0.22 (0.09-0.35); verbal memory 0.08. Executive function and attention: not significant. Home-based administration ineffective vs group-based. More than 3 sessions/week ineffective vs 3 or fewer. Only weak evidence for sessions under 30 minutes. No evidence for WM-only training. Bonnechère 2020 (commercial games, age 60+): 16 RCTs, n=1,543. Processing speed SMD 0.40 (0.20-0.60); WM 0.21; executive function 0.21; verbal memory 0.12; no effect on attention or visuospatial. Lampit 2020 network meta-analysis (medRxiv preprint, not confirmed peer-reviewed): 90 RCTs, n=7,219, g=0.18; supervised training and 3 or fewer sessions/week did better; multidomain CCT was most efficacious.
  quality: Meta-analyses of RCTs (no GRADE). Heterogeneous trials. Effect-modifier findings are between-study meta-regressions.
  implication: Make the default '오늘의 훈련' a mixed multidomain set of 3-4 games, about 20-30 minutes, with up to 3 full sessions a week recommended. Do not use a daily streak as the main goal. Order the games so speed tasks (Odd One Out, Number Hunt) are always included. Treat Color Word and attention tasks as weaker-evidence variety. Unsupervised home use is the weakest format, so add light accountability: a weekly summary, family or friend sharing, group challenges.
- (reviews-guidelines #6) [verified] Li Z 2024 "Effects of engagement, persistence and adherence on cognitive training outcomes in older adults with and without cognitive impairment: a systematic review and meta-analysis of randomised controlled trials" Age and Ageing 53(1):afad247 (PMID 38266127) https://doi.org/10.1093/ageing/afad247
  claim: Cognitive-training benefit depends on dose actually completed. In a meta-analysis cited by WHO 2026, effects were significant only when engagement or persistence exceeded 60% or adherence exceeded 80%.
  numbers: 55 RCTs, n=4,455, mean age 73.9. Cross-domain effect g=0.286 (0.224-0.348). Effects were significant when engagement or persistence rates were above 60% or adherence above 80%. Memory, visuospatial and reasoning needed higher persistence than executive function or attention. Cognitively normal adults needed higher persistence than people with impairment.
  quality: SR/MA of RCTs, subgroup (between-study) analyses. Cited as WHO 2026 reference 26.
  implication: The requested lives mechanic should end a ROUND, not the user's motivation. Suggested rules: 3 misses ends the round. The next round starts slightly below the last level instead of resetting to level 1. A fixed session cap (time or number of trials) ends 'today's training'. Track and show planned vs completed sessions per week (adherence) more prominently than high scores. Keep the staircase target success rate around 75-80% so older users are not discouraged.
- (reviews-guidelines #7) [verified] Simons DJ 2016 "Do "Brain-Training" Programs Work?" Psychological Science in the Public Interest 17(3):103-186 (PMID 27697851) https://doi.org/10.1177/1529100616661983
  claim: The most thorough independent review of brain-training evidence found strong evidence for improvement on the trained tasks, less for closely related tasks, and little for distant tasks or everyday cognition. None of the studies cited by the industry met all of the review's best-practice criteria.
  numbers: Reviewed all peer-reviewed intervention studies cited by brain-training companies on cognitivetrainingdata.org, the site backing the 133-signatory pro-training letter (the opposing consensus letter had 70+ scientists). Results: extensive evidence of trained-task gains, less near transfer, little far transfer or everyday benefit. 0 studies conformed to all best practices (e.g., active control, preregistration, blinding of expectations).
  quality: Comprehensive narrative/critical systematic review by 7 cognitive scientists.
  implication: In-app levels and scores measure practice on that game only. Label them as '게임 기록/레벨', never as '기억력 23% 향상' or 'cognitive score'. Any future efficacy claim needs our own RCT with an active control and a preregistered far-transfer outcome.
- (reviews-guidelines #8) [verified] Melby-Lervåg M 2016 "Working Memory Training Does Not Improve Performance on Measures of Intelligence or Other Measures of "Far Transfer": Evidence From a Meta-Analytic Review" Perspectives on Psychological Science 11(4):512-534 (PMID 27474138) https://doi.org/10.1177/1745691616635612 ; Soveri A et al. Psychon Bull Rev 2017, https://doi.org/10.3758/s13423-016-1217-0 ; Sala G et al. Collabra: Psychology 2019, https://doi.org/10.1525/collabra.203
  claim: Working-memory training, the category of Flash Grid and Sequence (Corsi-like) recall, produces short-term near transfer to similar WM tasks. It shows no reliable far transfer to reasoning, intelligence or real-world skills. A second-order meta-analysis found the far-transfer effect was zero once placebo effects and publication bias were controlled.
  numbers: Melby-Lervåg 2016: 87 publications, 145 comparisons. Reliable immediate gains on verbal and visuospatial WM. No convincing far transfer vs treated controls, and 'no evidential value' after publication-bias analysis. Soveri 2017 (n-back): 33 RCTs, 203 effect sizes. Medium transfer to untrained n-back tasks; very small transfer to other WM tasks, fluid intelligence and cognitive control. Sala 2019: k=99/119/233. With placebo and publication bias controlled, 'the overall effect size and true variance equaled zero' for far transfer.
  quality: Multiple meta-analyses plus a second-order meta-analysis. Consistent results across them.
  implication: Describe Flash Grid and Sequence as practising spatial memory span ('공간 기억 과제 연습'). Never say '기억력/지능 향상' or 'helps you remember daily things'. Do not add n-back as a 'memory booster'; if added, frame it as variety or challenge.
- (reviews-guidelines #9) [corrected] Livingston G 2024 "Dementia prevention, intervention, and care: 2024 report of the Lancet standing Commission" The Lancet 404(10452):572-628 (PMID 39096926) https://doi.org/10.1016/S0140-6736(24)01296-0
  claim: The 2024 Lancet Commission estimates that about 45% of dementia is attributable to 14 modifiable risk factors. The largest shares are hearing loss and high LDL (7% each), then less education and social isolation (5% each). The Commission rates short-term, low-intensity CCT as having only low-quality evidence of short-term effect and none of long-term effect.
  numbers: PAF for all 14 factors = 45.3% (weighted for communality; HUNT cohort n≈37,000). The 14 factors: less education, hearing loss, high LDL, depression, TBI, physical inactivity, diabetes, smoking, hypertension, obesity, excessive alcohol, social isolation, air pollution, untreated vision loss. Hearing loss 7%, high LDL 7%, less education 5%, social isolation 5%, vision loss 2% (per the Lancet press release). On CCT: 'short term, low intensity CCT interventions... have only low quality evidence of short-term effectiveness and none of long term effectiveness in maintaining cognition.'
  quality: Expert commission. PAF modelling from meta-analysed observational RRs, which assumes causality.
  implication: In-app 'why' content should rank hearing (hearing check, use of hearing aids), cholesterol and BP, physical activity and social contact above brain games. Use 45% only as a population-level estimate, e.g. '치매의 약 45%가 14가지 조절 가능한 위험요인과 관련된다는 추정(Lancet 2024)'. Never present it as a personal risk reduction from playing.
  CHECKER: Small fix to one quote; every number checks out (PAF 45.3%, HUNT communality from 37,000 people aged 45+, hearing loss 7%, LDL 7%, social isolation 5%, less education 5%, vision loss 2%). The CCT quote is word-for-word from the UCL accepted manuscript. The published Lancet version reads: 'short-term computerised cognitive training interventions at low intensity, which can be financially costly, have only low-quality evidence of short-term effectiveness and no evidence of long-term effectiveness in maintaining cognition.' Quote the published version. (https://vcoa.chp.vcu.edu/media/chp-college-of-health-professions/PIIS0140673624012960.pdf (version of record, Table 1); https://discovery.ucl.ac.uk/id/eprint/10196488/)
- (reviews-guidelines #10) [verified] Ngandu T 2015 "A 2 year multidomain intervention of diet, exercise, cognitive training, and vascular risk monitoring versus control to prevent cognitive decline in at-risk elderly people (FINGER): a randomised controlled trial" The Lancet 385(9984):2255-2263 (PMID 25771249) https://doi.org/10.1016/S0140-6736(15)60461-5
  claim: FINGER, the landmark multidomain RCT, improved cognition in at-risk adults aged 60-77. Its cognitive-training component was a short, frequent, web-based programme with set task types. The gains came from the whole package and cannot be attributed to the games alone.
  numbers: n=1,260 randomised (631 intervention, 629 control). Between-group difference in NTB total change: 0.022 SD per year (95% CI 0.002-0.042, p=0.030), i.e. a 25% greater improvement. Executive functioning improved 83% more (p=0.039), processing speed 150% more (p=0.029). No effect on prespecified memory. OR for cognitive decline in controls: 1.31 (1.01-1.71). CCT dose: 72 sessions per 6-month block × 2 blocks, 3 times a week, 10-15 minutes each, home or study site. Tasks: updating (spatial, letter, number), mental set-shifting, WM maintenance, episodic memory (relational, spatial), mental speed (shape match). Self-reported CT participation: 85%.
  quality: Large double-blind RCT, 2 years. Primary outcome positive but small. Multidomain design, so the CT effect cannot be isolated.
  implication: A concrete, citable dose template is 3 times a week, 10-15 minutes, in blocks of months. Mapping: Flash Grid ≈ spatial updating; Sequence ≈ WM maintenance; Match Pairs ≈ spatial/relational episodic memory; Odd One Out and Number Hunt ≈ mental speed. Gaps: set-shifting (task switching) and letter/number updating. If adding a game, a task-switching game fills the clearest gap.
- (reviews-guidelines #11) [corrected] Baker LD 2025 "Structured vs Self-Guided Multidomain Lifestyle Interventions for Global Cognitive Function: The US POINTER Randomized Clinical Trial" JAMA (PMID 40720610) https://doi.org/10.1001/jama.2025.12923
  claim: US POINTER (2025): a STRUCTURED, higher-intensity multidomain programme improved global cognition slightly more than a self-guided one. The structured programme included BrainHQ cognitive training 3 times a week for 15-20 minutes. Structure and accountability, not just access to activities, made the difference.
  numbers: n=2,111, age 60-79, at risk, 2 years, 89% completed year 2. Global composite z gain per year: structured 0.243 SD (0.227-0.258) vs self-guided 0.213 SD (0.198-0.229). Difference 0.029 SD/year (0.008-0.050, p=0.008). Same benefit in APOE ε4 carriers and non-carriers. Larger benefit with lower baseline cognition (interaction p=0.02). Structured arm cognitive component: web-based BrainHQ 3×/week, 15-20 minutes per session. Self-guided arm: 'computer cognitive training at home'.
  quality: Large multicentre single-blind RCT. Active comparator (no no-intervention arm). Small effect size.
  implication: Build structure into the app: a weekly plan (3 sessions of 15-20 minutes), gentle reminders, a progress review, and optional peer or family accountability. Even with that, do not cite POINTER as evidence that these specific games work. Both POINTER arms were multidomain, and the difference is about 0.03 SD per year.
  CHECKER: Wrong about the self-guided arm. In JAMA Figure 1B, 'Computer cognitive training at home' (BrainHQ, 3 times a week, 15-20 min) belongs to the STRUCTURED arm. The self-guided arm had 6 peer-team meetings plus education, tools and 'general support to encourage physical activity, a healthy diet, and cognitive and social stimulation', with no prescribed CCT. So the claim that 'structure and accountability, not just access to activities, made the difference' goes too far: only the structured arm got CCT, so the trial cannot separate structure/accountability from CCT exposure. All the numbers are correct (n=2,111; 0.243 vs 0.213; difference 0.029, 0.008-0.050, P=.008; APOE interaction P=.95; baseline-cognition interaction P=.02; 89% completed year 2). The paper is JAMA 2025;334(8):681-691. (https://www.brainhq.com/wp-content/uploads/2025/07/ja-uspointer-jama.pdf (JAMA PDF, Figure 1B); https://pmc.ncbi.nlm.nih.gov/articles/PMC12305445/)
- (reviews-guidelines #12) [verified] Coe NB 2026 "Impact of cognitive training on claims-based diagnosed dementia over 20 years: evidence from the ACTIVE study" Alzheimer's & Dementia: Translational Research & Clinical Interventions (PMID 41669119); 10-year: Edwards JD et al., same journal 2017 (PMID 29201994) https://doi.org/10.1002/trc2.70197 ; https://doi.org/10.1016/j.trci.2017.09.002
  claim: Speed-of-processing training (adaptive, speeded visual search with divided attention) is the only single-domain cognitive training with a long-term dementia signal in an RCT (ACTIVE). In the 20-year Medicare-claims follow-up the signal appeared only in people who did booster sessions. Memory and reasoning training showed no effect.
  numbers: Edwards 2017: N=2,802, up to 10 sessions over 6 weeks plus boosters at 11 and 35 months. At 10 years, speed training HR 0.71 (0.50-0.998, p=0.049); memory HR 0.79 (n.s.); reasoning HR 0.79 (n.s.). Each additional speed session: unadjusted HR 0.90. Coe 2026 (n=2,021 linked to Medicare 1999-2019): speed training WITH 1 or more booster, HR 0.75 (0.59-0.95). Speed training without boosters: HR 1.01 (0.81-1.27). No effect of memory or reasoning arms.
  quality: Single RCT, secondary long-term analyses. The booster subgroup is post-randomisation, so self-selection is possible. Claims-based outcome. Not yet replicated. This is the trial NASEM's positive conclusion rested on.
  implication: Strengthen a true speed-of-processing game. For example, give Odd One Out a 'divided attention' mode: a central identification plus a peripheral target, with a staircase on display time rather than only on grid size. Add scheduled 'booster' re-engagement blocks after weeks or months. Still no dementia claims: one trial with a post-hoc booster subgroup.
- (reviews-guidelines #13) [corrected] 보건복지부·중앙치매센터 (Ministry of Health and Welfare / National Institute of Dementia) 2014 "치매예방수칙 3·3·3 (3권·3금·3행)" 보건복지부 국가치매관리위원회 발표 (2014); restated in NHIS webzine 2023-09; 제5차 치매관리종합계획 2026-2030 (MOHW press release, 2026) https://www.nhis.or.kr/static/alim/paper/oldpaper/202309/sub/section1_4.html ; http://www.docdocdoc.co.kr/news/articleView.html?idxno=159669 ; https://mohw.go.kr/board.es?act=view&bid=0027&list_no=1489107&mid=a10503010100 ; SUPERBRAIN-MEET: Moon SY et al. Alzheimers Dement 2025, https://doi.org/10.1002/alz.14517
  claim: Korean public guidance treats cognitive activity as one of nine everyday prevention habits, not as a therapy. Korea's national plan is moving to quality-control the cognitive programmes run at 치매안심센터. A Korean RCT supports a tablet-app-delivered multidomain intervention in MCI, delivered in a clinical setting.
  numbers: 3권 (enjoy): 일주일에 3번 이상 걷기, 생선과 채소 골고루 먹기, 부지런히 읽고 쓰기. 3금 (avoid): 술 적게, 담배 피지 않기, 머리 다치지 않기. 3행 (do): 정기 건강검진, 가족·친구와 자주 소통, 매년 치매 조기검진 (보건소 free screening for 60+). 5th plan: 5 strategies, 10 initiatives, 73 projects. Per press coverage: in 2026 the NID builds quality management for 치매안심센터 cognitive-intervention programmes, and ICT cognitive-training devices enter welfare-equipment pre-benefit from 2027. SUPERBRAIN-MEET: n=300 MCI, 24 weeks, 17 hospitals. RBANS change 8.43 vs 4.26, difference 4.17 (1.92-6.43). Adherence 84.7%.
  quality: Government public-health guidance (expert consensus, no GRADE). The 3·3·3 primary page on nid.or.kr was unreachable, so it is cited via NHIS and news. SUPERBRAIN-MEET is a multicentre RCT.
  implication: For Korean users, show a 3·3·3 card next to the games ('부지런히 읽고 쓰기' is where the brain games fit). Add a link to the nearest 치매안심센터 and the free 60+ screening. Copy example: '두뇌 활동은 보건복지부 치매예방수칙 3·3·3 중 하나입니다.'
  CHECKER: One small fix. SUPERBRAIN-MEET was not delivered purely in a clinical setting. It was hybrid: face-to-face sessions at a facility every 1-2 weeks (17 hospitals), plus self-administered tablet cognitive training at home and Zoom group sessions at home. Everything else checks out. 3·3·3 was announced in Sept 2014 by MOHW's national dementia management committee, and NHIS lists 3권 exercise/diet/reading, 3금 drinking/smoking/head injury, 3행 health check/socialising/early screening. The 5th plan has 5 strategies, 10 initiatives and 73 projects. Press reports confirm NID quality management of 치매안심센터 cognitive-intervention programmes in 2026 and ICT cognitive-training devices entering welfare-equipment pre-benefit from 2027. The trial numbers are correct: n=300, 24 weeks, RBANS 8.43 vs 4.26, difference 4.17 (1.92-6.43), adherence 84.7%. (https://www.nhis.or.kr/static/alim/paper/oldpaper/202309/sub/section1_4.html ; http://www.docdocdoc.co.kr/news/articleView.html?idxno=159669 ; https://mohw.go.kr/board.es?act=view&bid=0027&list_no=1489107&mid=a10503010100 ; https://bravo.etoday.co.kr/view/atc_view/18588 ; Europe PMC PMC11848216)
- (reviews-guidelines #14) [corrected] 식품의약품안전처 (Ministry of Food and Drug Safety) 2026 "의료기기와 개인용 건강관리(웰니스)제품 판단기준 (revised 2026-02-12)" MFDS guideline (first issued 2015-07; revised 2026-02-12, reflecting the FDA 2026 wellness guidance); FTC press release 2016-01-05; Apple App Store Review Guideline 1.4.1 https://www.mfds.go.kr/brd/m_861/view.do?seq=20156 ; https://www.foodtoday.or.kr/news/article.html?no=202482 ; https://www.ftc.gov/news-events/news/press-releases/2016/01/lumosity-pay-2-million-settle-ftc-deceptive-advertising-charges-its-brain-training-program ; https://developer.apple.com/app-store/review/guidelines/#1.4.1
  claim: In Korea, an app that claims to prevent or treat disease is legally a medical device. Wellness apps for everyday health maintenance are exempt only if they make no disease claims. A cognitive-training app for MCI has already been approved as a digital therapeutic. US and app-store precedent punishes unsupported dementia claims.
  numbers: Wellness = daily health maintenance or chronic-disease self-management with low risk. Products intended for 'diagnosis, treatment, or prevention of disease' are excluded and need MFDS device approval. 이모코그 '코그테라' (12 weeks, twice daily, app-based cognitive training) was approved May 2025 as Korea's first MCI digital therapeutic (7th DTx), with prescriptions from Oct 2025 (per press reports). FTC v. Lumos Labs: $2M redress, $50M judgment suspended. Claims about delaying age-related decline and protecting against MCI, dementia and Alzheimer's were deemed unsubstantiated. Future claims need 'competent and reliable scientific evidence'. Apple 1.4.1: health claims need disclosed data and methodology, and apps should remind users to consult a doctor.
  quality: Regulatory guidance and enforcement precedent. Cogthera approval details come from press reports, not the MFDS approval record.
  implication: Words to avoid in the app, store listings and ads in all 8 locales: '치매 예방', '치매 위험 감소', '인지기능 개선 효과 입증', '뇌 나이', '치료', 'clinically proven'. Use instead: '두뇌 활동', '집중력·기억 게임', '건강한 두뇌 습관'. Add a disclaimer: '이 기능은 의료기기가 아니며 질병의 진단·치료·예방을 목적으로 하지 않습니다. 기억력이 걱정되면 치매안심센터나 의사와 상담하세요.' Keep the store category as Education, not Medical.
  CHECKER: Small fixes. (1) Apple 1.4.1 is narrower than stated: it requires disclosed data and methodology for 'accuracy claims relating to health measurements', not for health claims in general. It also says apps 'should remind users to check with a doctor'. It does not mention dementia claims specifically. (2) The MFDS link is the original 2015-07-13 posting. The 2026-02-12 revision, which reflects the FDA's January 2026 wellness guidance, is confirmed only by press (foodtoday). (3) Cogthera: approved 2025-05-23 as Korea's 7th DTx and first for MCI, 12 weeks, twice daily. Press reports prescriptions starting mid-to-late Oct 2025, though some outlets date the first hospital prescriptions (Yongin Severance, Ewha Mokdong) to Nov 18, 2025. The FTC numbers are correct ($2M redress, $50M judgment suspended, 'competent and reliable scientific evidence'). (https://developer.apple.com/app-store/review/guidelines/ ; https://www.mfds.go.kr/brd/m_861/view.do?seq=20156 ; https://www.foodtoday.or.kr/news/article.html?no=202482 ; http://www.docdocdoc.co.kr/news/articleView.html?idxno=3028705 ; https://www.ftc.gov/news-events/news/press-releases/2016/01/lumosity-pay-2-million-settle-ftc-deceptive-advertising-charges-its-brain-training-program)
Open questions: No systematic review or guideline tests a 'lives' / end-after-N-misses rule. Every evidence-based protocol (FINGER, POINTER, ACTIVE) is a fixed dose (time or sessions) with adaptive difficulty. Whether lives help or hurt adherence in older adults is unknown and should be A/B tested on completion and return rates. | WHO 2026 reports cognitive training as Hedges' g 0.25, but its cited source (Li 2024, Age Ageing) reports g 0.286 overall. Web Annex evidence profiles (GRADE tables) were not read, so which subset WHO used is unverified. | The Lampit 2020 network meta-analysis (90 RCTs, g 0.18, supervised and up to 3x/week better, multidomain CCT best) was verified only as a medRxiv preprint. Peer-reviewed publication was not confirmed. | The Lancet 2024 per-factor PAFs (hearing 7%, LDL 7%, education 5%, social isolation 5%, vision 2%) were confirmed from the Lancet press release and the 45.3% total from the accepted manuscript. The full Table 1 was not checked. | The primary 중앙치매센터 page for 치매예방수칙 3·3·3 (nid.or.kr) failed DNS resolution, so it is cited via NHIS webzine (2023) and news. The original 2014 announcement date varies between sources (March vs September 2014). | The 의료기기법 Article 2 definition text and the advertising-restriction article could not be retrieved (law.go.kr is JS-rendered). The wellness exclusion rule is cited via the MFDS notice and press coverage of the 2026-02-12 revision. The full revised guideline PDF, including whether it has a cognitive-game example, was not read. | Cogthera (이모코그) MFDS approval date and indication come from press reports, not the MFDS approval database. Its pivotal trial effect sizes were not retrieved. | The ACTIVE 20-year booster effect (HR 0.75) is a post-randomisation subgroup with a claims-based outcome and is unreplicated. Whether app-based speed games resembling UFOV training carry any of this effect is unknown. | None of the 8 shipped games has been evaluated in any trial. The mapping to FINGER or ACTIVE task types is by analogy only, and any efficacy statement would require the app's own controlled study. | Google Play Health Content and Services policy text was not checked; only Apple guideline 1.4.1 was verified.

### design-ux-regulation
- (design-ux-regulation #0) [verified] Kaernbach C 1991 "Simple adaptive testing with the weighted up-down method (plus Levitt H., 'Transformed up-down methods in psychoacoustics', JASA 1971;49(2B):467-477, doi:10.1121/1.1912375)" Perception & Psychophysics 49(3):227-229 https://doi.org/10.3758/BF03214307
  claim: In a weighted up-down staircase the difficulty settles where S_up·p = S_down·(1−p), so you can pick the target accuracy just by choosing the ratio of the two step sizes. Transformed rules only offer fixed points: 1-up-2-down gives 70.7% and 1-up-3-down gives 79.4% (Levitt 1971). Kaernbach's weighted rule reaches 75% with a 1:3 step ratio, with about 5% less error, or about 10% fewer trials, than 1-up-2-down.
  numbers: Eq. 1: S_up·p = S_down·(1−p). For X75, S_up/S_down = 1/3 (step 1 after each correct answer, 3 after each error). 1-up-2-down converges to X70.7 and 1-up-3-down to X79.4. Optimal step is about 1/6 of the psychometric spread. Monte Carlo used 10,000 tracks per condition. Applied to our current rule (+0.3 harder per correct, −0.8 easier per miss): p = 0.8/(0.8+0.3) = 72.7%. If every correct answer gets the fast step (+0.45): p = 0.8/1.25 = 64.0%. So the real target drifts between 64% and 73% depending on how fast the user is.
  quality: Methods paper with a Monte Carlo simulation. It is about psychophysical threshold estimation, not training outcomes. Levitt 1971 is the foundational analytic treatment.
  implication: Make target accuracy an explicit setting per game. The ratio of easier-step to harder-step equals p/(1−p): 3:1 for 75%, 4:1 for 80% (e.g. +0.2 / −0.8), 5.67:1 for 85% (e.g. +0.15 / −0.85). Take the fast bonus out of the staircase and keep it in score or stars only; otherwise the target quietly falls toward 64% for fast users. Use larger steps for roughly the first 8 trials of a session (Kaernbach's 'initial phase'), then switch to small steps. Start the next session from the level the user settled at minus a small warm-up offset, not from their peak.
- (design-ux-regulation #1) [verified] Wilson RC 2019 "The Eighty Five Percent Rule for optimal learning" Nature Communications 10:4646 https://doi.org/10.1038/s41467-019-12552-4 (PMC6831579)
  claim: In theory, learning is fastest at about 15.87% error (about 85% accuracy). The authors note that psychology staircases are commonly set to 80-85% and that engagement peaks at intermediate difficulty. The result is theoretical and has not been tested as an optimum for human learning.
  numbers: Optimal error rate is 15.87% under Gaussian noise, i.e. about 85% accuracy. Quote: staircasing procedures 'are commonly designed to produce about 80–85% accuracy'. The authors limit the result to binary classification with gradient-descent learners. Our own calculation: with 3 hearts, the expected trials before a round ends is 3/(1−p): 8.3 at 64%, 11.0 at 72.7%, 15 at 80%, 20 at 85%.
  quality: Computational and theoretical (simulated learners and neural networks). No human trial validates 85%.
  implication: If lives are introduced, raise the training target from about 73% (a point used for measuring thresholds) to 80-85%. At 73%, a 3-heart round ends after about 11 trials on average and every round ends in failure. At 85% it lasts about 20 trials. Call 85% a heuristic, not a law, and log each game's actual accuracy to confirm where the staircase really settles.
- (design-ux-regulation #2) [verified] Brehmer Y 2012 "Working-memory training in younger and older adults: training gains, transfer, and maintenance" Frontiers in Human Neuroscience 6:63 https://doi.org/10.3389/fnhum.2012.00063
  claim: In older adults as well as younger ones, adaptive working-memory training produced larger trained gains than practice kept at a fixed easy level. There was transfer to sustained attention and to self-rated everyday cognition, and the gains held at 3 months.
  numbers: Older adults: n = 45 (26 adaptive, 19 controls kept at 2 items); younger adults: n = 55. Cogmed at home for about 5 weeks (20-25 days), mean 26 min/day, 90 WM trials/day. Adaptive training gave larger gains than low-level practice, maintained at 3-month follow-up.
  quality: Small RCT with an active control. Working-memory only.
  implication: Adaptivity is the active ingredient, not just playing. Don't reward streaks earned on easy levels. Show each game's current level as the main progress number, and keep the level when a round ends, so lives never push users back to easy play. Lampit 2014 found no evidence for working-memory-only programs, so keep the mixed battery (speed, visual search, inhibition) rather than leaning on Flash Grid and Sequence.
- (design-ux-regulation #3) [verified] Lampit A 2014 "Computerized Cognitive Training in Cognitively Healthy Older Adults: A Systematic Review and Meta-Analysis of Effect Modifiers" PLoS Medicine 11(11):e1001756 https://doi.org/10.1371/journal.pmed.1001756
  claim: Computerized cognitive training gives small test gains in healthy older adults (g = 0.22). Unsupervised home training and more than 3 sessions per week showed no effect. Evidence that sessions under 30 minutes work is weak.
  numbers: 52 RCTs, 4,885 participants, at least 4 h of training. Overall g = 0.22 (95% CI 0.15-0.29). By domain: processing speed 0.31, visuospatial 0.30, nonverbal memory 0.24, working memory 0.22, verbal memory 0.08; executive function and attention not significant. Group-based g = 0.29 (0.21-0.38) vs home-based g = 0.09 (−0.02 to 0.21, p = 0.11). More than 3 sessions/week: no positive evidence for any outcome (29 studies ran 2-3/week, 17 ran more than 3, 6 ran once a week). Working-memory training alone: no evidence. Sessions under 30 min: weak evidence.
  quality: Systematic review and meta-analysis of RCTs. The moderator results compare across studies and may be confounded. Outcomes are neuropsychological tests, not dementia.
  implication: Make the default plan about 3 sessions a week, 20-30 minutes each (all 8 games at about 3 minutes each), not a daily streak or '5 minutes a day'. Use a weekly goal and give no extra rewards beyond 3 sessions a week. Because unsupervised home training showed no reliable effect, add light social structure such as a shared weekly report or a family check-in. Never write that home training is proven.
- (design-ux-regulation #4) [verified] Coe NB 2026 "Impact of cognitive training on claims-based diagnosed dementia over 20 years: evidence from the ACTIVE study" Alzheimer's & Dementia: Translational Research & Clinical Interventions 12(1):e70197 https://doi.org/10.1002/trc2.70197
  claim: The only RCT-based signal on dementia outcomes comes from ACTIVE's speed-of-processing training plus booster sessions. Over 20 years, claims-based diagnoses were lower in booster completers but not in speed-trained participants without boosters. Memory and reasoning training had no effect.
  numbers: Coe 2026: n = 2,021 in traditional Medicare. Speed training with ≥1 booster: HR 0.75 (0.59-0.95). Speed training without booster: HR 1.01 (0.81-1.27). Memory and reasoning: no main effect. Press coverage reports 40% (105/264) vs 49% (239/491) diagnosed. Booster eligibility required completing ≥8 of 10 initial sessions, so selection bias is possible. Protocol (Ball 2002, JAMA 288(18):2271, doi:10.1001/jama.288.18.2271): 2,832 people aged 65-94; 10 group sessions of 60-75 min over 5-6 weeks; 4-session booster offered at 11 months to a 60% random sample (later boosters also at 35 months); reliable improvement in 87% (speed), 74% (reasoning), 26% (memory); 'no training effects on everyday functioning' at 2 years. Edwards 2017 (doi:10.1016/j.trci.2017.09.002): 10-year HR 0.71 (0.50-0.998); each extra speed session unadjusted HR 0.90 (0.85-0.95).
  quality: Large multisite RCT. The 20-year result is a secondary analysis of Medicare claims, and the booster subgroup is defined by non-randomized completion.
  implication: Do not transfer these numbers to our games. ACTIVE was supervised and in person, with a specific divided-attention and visual-search task at a specific dose. An in-app 'research background' page may describe ACTIVE neutrally with these caveats. We can borrow the structure without making claims: a 'course' of 10 sessions over 5-6 weeks plus booster reminders around 11 and 35 months, with completed sessions as the honest dose metric. If one game should mirror the ingredient that carries the evidence, rework Odd One Out into an adaptive speed-of-processing / divided-attention task, still with no outcome claim.
- (design-ux-regulation #5) [verified] Simons DJ 2016 "Do 'Brain-Training' Programs Work? (plus Gates NJ et al., Cochrane CD012277.pub3, 2020)" Psychological Science in the Public Interest 17(3):103-186 https://doi.org/10.1177/1529100616661983 | Cochrane: https://doi.org/10.1002/14651858.CD012277.pub3
  claim: Brain training reliably improves the trained tasks, less so closely related tasks, and there is little evidence for distant tasks or everyday cognition. Cochrane finds a small, low-certainty benefit right after training that is not seen at 12 months.
  numbers: Simons: 'extensive evidence' for the trained task, less for closely related tasks, 'little evidence' for distant tasks or everyday performance. Gates 2020 (late life, ≥12 weeks of training): 8 trials, 1,183 participants. Global cognition vs active control at end of training: SMD −0.31 (−0.57 to −0.05; 2 studies, n = 232). At 12 months: SMD −0.21 (−0.66 to 0.24; 1 study, n = 77). Certainty low to very low.
  quality: Comprehensive critical review commissioned by APS, plus a Cochrane systematic review (low to very-low certainty).
  implication: Progress copy may describe in-game performance only, e.g. '숫자 찾기 레벨 5.2 → 6.0' or '이 게임 기록이 좋아졌어요'. Never write '기억력이 좋아졌어요', '뇌 나이 −5세', '일상생활 능력 향상' or '인지기능 향상 입증'. Don't build a combined 'brain score' or 'brain age' that implies general cognition.
- (design-ux-regulation #6) [verified] Vermeir JF 2020 "The Effects of Gamification on Computerized Cognitive Training: Systematic Review and Meta-Analysis" JMIR Serious Games 8(3):e18644 https://doi.org/10.2196/18644
  claim: Gamification makes cognitive training more motivating, but it also makes tasks feel more demanding, and no effect on cognitive outcomes was detected.
  numbers: 49 studies reviewed, 9 RCTs meta-analyzed (2008-2018). Motivation/engagement Hedges g = 0.72. Demand/difficulty g = −0.52 (gamified tasks felt harder). No effect on the training domain (cognitive or clinical outcomes). No moderators found. The number of studies is small.
  quality: Systematic review and meta-analysis of a small number of RCTs, in mixed populations rather than only older adults.
  implication: Lives are a motivation and pacing device, not an efficacy feature. Because gamification already adds perceived demand, don't stack hearts, countdown timers, red flashes and 'GAME OVER' sounds together. Keep hearts visible but calm, and open the end screen with the best level reached and any personal best. Offer a no-hearts practice mode. A/B test 3 hearts vs none among users aged 60+ on round completion, D7/D28 retention and self-reported frustration.
- (design-ux-regulation #7) [corrected] Turunen M 2019 "Computer-based cognitive training for older adults: Determinants of adherence (plus Zhang 2025 JMIR doi:10.2196/66393 and Roque & Harrell 2020 Innov Aging doi:10.1093/geroni/igaa057.1325)" PLoS ONE 14(7):e0219541 https://doi.org/10.1371/journal.pone.0219541
  claim: Unsupervised home cognitive training among at-risk older adults has very low adherence, and prior computer use is the only predictor of how many sessions get done. Complexity and frustration drive dropout. Older adults most want feedback on their performance and control over difficulty.
  numbers: FINGER: n = 631, ages 60-77 (mean 69.5). 63% started; 20% did ≥50% of sessions; 12% completed all 144; median 15 sessions. Prescribed 3 times a week for 10-15 min. Prior computer use was the only factor tied to more sessions. Zhang 2025: 19 older adults with MCI (mean age 73.3) plus 4 family members; 32% met the recommended weekly dose over one month; quote: 'Simpler would be better; this is too complicated.' Roque & Harrell 2020: n = 100 aged 64+; features they said would raise adherence: performance feedback 53%, adjustable difficulty 47%, unlockables 28%, theme change 20%.
  quality: Observational analysis inside an RCT, a qualitative study, and a conference abstract (weak).
  implication: Give one large '오늘의 훈련 시작' button that runs the whole session in order. On first run, show a guided demo of each game with an unscored practice trial. Show each game's level trend, offer an explicit '쉽게 시작' option, and give weekly progress feedback. Tie reminders to the weekly plan. Most users will lapse, so make coming back easy and never punish a broken streak.
  CHECKER: All numbers check out: FINGER n=631, mean age 69.5, 63/20/12%, median 15, 3x/week for 10-15 min; Zhang 6/19 = 32%, mean age 73.3, quote exact; Roque 53/47/28/20%. Three parts of the claim go further than the sources. (1) FINGER training was not purely 'unsupervised home' training. It began with 6 group sessions, and participants could then train at home or at study centres. (2) 'Complexity and frustration drive dropout' is not from Turunen, which did not study reasons for dropout. It comes from Zhang's qualitative study of 19 people. There, confusion was one reason among several: a gap between expectation and reality, delayed versus immediate gratification, cost, and family pressure. 'Frustration' is not a stated finding. (3) The best supported wording is: prior computer use was the only predictor of more sessions completed, and in one small qualitative MCI study, perceived complexity or confusion was among the reasons people stopped. (https://pmc.ncbi.nlm.nih.gov/articles/PMC6620011/)
- (design-ux-regulation #8) [corrected] Kessels RPC 2000 "The Corsi Block-Tapping Task: Standardization and Normative Data" Applied Neuropsychology 7(4):252-258 https://doi.org/10.1207/S15324826AN0704_8 (procedure as implemented: https://www.millisecond.com/library/corsiblocktappingtask)
  claim: The standard Corsi administration gives two attempts at each sequence length and stops when both attempts at one length fail. This is a validated, principled 'lives' rule for span tasks.
  numbers: Sequences run from 2 up to 9 blocks, 2 attempts per length; the task ends when both attempts at a length fail. The computerized version presents 1 block per second. Healthy adults' mean span is 6.2 (SD 1.3); normative sample of 70 healthy adults and 70 patients. Our calculation: expected trials until 2 misses in a row = (1+q)/q², where q is the miss rate. That is about 17 trials at 73% accuracy, 30 at 80% and 51 at 85%.
  quality: Standardized neuropsychological procedure with normative data. The discontinue rule was checked against a Kessels-based implementation, not the original full text.
  implication: For Sequence and Flash Grid, use 'two tries per level; fail both and the round ends' rather than a fixed number of total misses. For the speed games (Number Hunt, Color Word, Quick Math, Odd One Out), use 3 hearts with the staircase target at 80-85%. Keep presentation at 1 item per second or slower, which also stays within WCAG 2.3.1 (no more than 3 flashes per second).
  CHECKER: The procedure is right: start at 2 blocks, 2 trials per length, stop when both trials at a length fail, about 1 block per second. So are the norms (n=70 healthy and 70 patients, healthy mean span 6.2, SD 1.3) and the arithmetic ((1+q)/q² gives about 17, 30 and 51 trials). Calling it a 'validated, principled lives rule' overstates it. Kessels 2000 standardized the administration and published norms; it did not validate the stop rule. Arce and McMullen (2021) note that stop rules differ widely between studies and that their effect on scores is barely studied. Also, Kessels' standard is the physical version: the examiner taps the blocks with an index finger at about 1 block per second. The computerized timing is Millisecond's own implementation. (https://par.nsf.gov/servlets/purl/10292489)
- (design-ux-regulation #9) [verified] Kobayashi M 2011 "Elderly User Evaluation of Mobile Touchscreen Interactions" INTERACT 2011, LNCS 6946, pp. 83-99 https://opendl.ifip-tc6.org/db/conf/interact/interact2011-1/KobayashiHMAHI11.pdf (ACM: https://dl.acm.org/doi/10.5555/2042053.2042065)
  claim: Older adults (60s-70s) make many tap errors on small targets. Their touches scatter within about 8 mm and land to the right of the target, and a week of practice barely helps. The authors recommend targets of at least 8 mm and visible feedback even when a tap misses.
  numbers: n = 20 Japanese participants in their 60s-70s. On a 3.5-inch device at 163 ppi: 30 px targets (about 4.7 mm) had 39% tap errors, 50 px (about 7.8 mm) 6.5%, 70 px (about 10.9 mm) 5.6%. On an iPad: 13.6%, 1.4% and 1.7%. The HCI 'acceptable' level is about 4%. In week 1, touches landed on average 12.9 px (SD 10.0) to the right of target centre. 30 px targets took about twice as long to tap. Recommendation: targets of 8 mm or larger. Note that Android's 48 dp is 7.6 mm (1 dp = 1/160 inch), just below this.
  quality: Lab usability experiment with a small sample on 2011-era devices.
  implication: Make game tiles at least about 9 mm (about 56 dp/pt), and preferably 64 dp or more. Raise difficulty through count, sequence length or time, never by shrinking cells below that size; cap the grid dimension by screen width. Leave gaps of at least 8 dp and extend each tile's hit area past its visible edge. Ignore a tap that lands in a gap or outside all tiles, and show a ripple where it landed. Motor mis-taps must never cost a heart.
- (design-ux-regulation #10) [corrected] W3C (Accessibility Guidelines Working Group) 2023 "Web Content Accessibility Guidelines (WCAG) 2.2 (plus Apple HIG Accessibility; Android 'Make apps more accessible'; Hou G et al., Front Psychol 2022 doi:10.3389/fpsyg.2022.931646)" W3C Recommendation https://www.w3.org/TR/WCAG22/ | https://developer.apple.com/design/human-interface-guidelines/accessibility | https://developer.android.com/guide/topics/ui/accessibility/apps
  claim: Accessibility standards and platform guidelines give concrete minimums for target size, contrast, text resizing, time limits and flashing. Older-adult game UI should meet AA and aim for AAA.
  numbers: WCAG 2.2: 2.5.8 (AA) targets ≥24×24 CSS px; 2.5.5 (AAA) ≥44×44. 1.4.3 (AA) text contrast 4.5:1 (large text 3:1); 1.4.6 (AAA) 7:1 (large 4.5:1); 'large' means ≥18 pt or 14 pt bold, or the CJK equivalent. 1.4.11 non-text contrast 3:1. 1.4.4 text resizable to 200%. 2.2.1 time limits can be turned off, adjusted to ≥10× or extended (with essential and real-time exceptions). 2.2.2 pause control for moving content lasting more than 5 s. 2.3.1 no more than 3 flashes per second. Apple HIG: default 44×44 pt (minimum 28×28); about 12 pt padding around bezeled controls and 24 pt around borderless ones; text enlargeable to ≥200%; 'Minimize use of time-boxed interface elements'; respect Reduce Motion. Android: ≥48×48 dp; 4.5:1 contrast for text under 18 sp. Hou 2022 (12 studies): older adults prefer larger fonts up to a critical size; on an iPhone 6s, recommended sizes ranged from about 10.5 to 20 pt depending on task.
  quality: W3C normative standard and platform vendor guidelines, plus a systematic review of 12 heterogeneous studies.
  implication: Lit vs unlit Flash Grid cells need at least 3:1 contrast plus a cue that isn't color (border or icon). All text needs at least 4.5:1, with 7:1 as the target in a large-text / high-contrast mode. Game numerals should be at least 20 pt and scale with Dynamic Type or the system font scale up to 200% without clipping. Cell lighting must stay at or below 3 flashes per second and respect Reduce Motion. Avoid moving targets and give every round a pause button.
  CHECKER: The WCAG 2.2, Apple HIG and Android figures all check out (24/44 px; 4.5:1, 7:1 and 3:1; 200%; ≥10× time; 5 s; 3 flashes/s; 44×44 pt default and 28×28 minimum; 12 pt and 24 pt padding; 200%; 'Minimize use of time-boxed interface elements'; 48×48 dp; 4.5:1 under 18 sp). The Hou 2022 font figure is wrong. The review (12 studies) reports, from Hou et al. 2020 on an iPhone 6s, that older adults preferred about 10.5-15 pt: 10.5 pt for information search, 13 pt for intensive reading and 13-14.5 pt for news and novels. They 'found larger sizes than mentioned unsatisfactory'. Nothing supports 20 pt. Minor: WCAG 2.2 became a Recommendation on 5 Oct 2023, and the current edition is dated 12 Dec 2024. (https://pmc.ncbi.nlm.nih.gov/articles/PMC9376262/)
- (design-ux-regulation #11) [verified] Der G 2006 "Age and sex differences in reaction time in adulthood: results from the United Kingdom Health and Lifestyle Survey" Psychology and Aging 21(1):62-73 https://doi.org/10.1037/0882-7974.21.1.62
  claim: Choice reaction time slows steadily across adulthood, while simple reaction time barely changes until about 50. Fixed millisecond speed thresholds therefore penalize older users. Apple's HIG recommends difficulty accommodations in games, including adjustable reaction time.
  numbers: n = 7,130 adults. Simple RT 'shows little slowing until around 50'. 4-choice RT 'slows throughout the adult age range'. The age effect on RT variability follows its mean and the error rate. Apple HIG: 'consider adding the ability to customize the difficulty level ... reduce the criteria for successfully completing a level, adjust reaction time, or enable control assistance.'
  quality: Large population survey (cross-sectional), plus a platform design guideline.
  implication: Define 'fast' relative to the user's own rolling median reaction time for each game (e.g. faster than their median over the last 20 correct trials), not in absolute milliseconds. Give the timed games (Color Word, Quick Math, Number Hunt) a relaxed-timing setting: ×1.5, ×2 or off. In relaxed or off mode, timeouts don't cost hearts.
- (design-ux-regulation #12) [verified] U.S. Federal Trade Commission 2016 "Lumosity to Pay $2 Million to Settle FTC Deceptive Advertising Charges for Its 'Brain Training' Program (FTC v. Lumos Labs, N.D. Cal.)" FTC press release and stipulated court order, 5 January 2016 https://www.ftc.gov/news-events/news/press-releases/2016/01/lumosity-pay-2-million-settle-ftc-deceptive-advertising-charges-its-brain-training-program
  claim: The FTC treated these Lumosity claims as deceptive: better performance at school, work and sport; delaying age-related decline; protecting against MCI, dementia and Alzheimer's; reducing impairment from stroke, TBI, PTSD, ADHD and similar conditions; and implying that science proved these benefits.
  numbers: $50M judgment, suspended once $2M was paid. Future claims about real-world performance, age-related decline or health conditions require 'competent and reliable scientific evidence'. Testimonials had been solicited through undisclosed contests (free iPad, lifetime subscription, trip to San Francisco). Subscribers from 2009-2014 had to be notified and given an easy way to cancel auto-renewal.
  quality: Regulatory enforcement precedent (court-entered settlement order).
  implication: In all 8 locales, never claim or imply better work or school performance, slowed aging, protection against dementia or MCI, help with any condition, or that something is 'scientifically proven'. Clearly disclose any incentivized reviews or testimonials. Make subscription cancellation easy. Have every marketing line pass a 'could we show RCT evidence for this exact outcome?' check.
- (design-ux-regulation #13) [verified] Apple Inc. 2026 "App Store Review Guidelines 1.4.1 and 2.3.1 (plus Google Play Developer Policy: Health Content and Services)" Apple App Store Review Guidelines (current) and Google Play Console Help answer 16679511 https://developer.apple.com/app-store/review/guidelines/ | https://support.google.com/googleplay/android-developer/answer/16679511
  claim: App stores scrutinize health and medical claims. Apple applies extra scrutiny to medical apps and removes apps for misleading marketing. Google Play requires a health declaration from every developer, and apps with medical functionality must show either regulatory proof or a 'not a medical device' disclaimer.
  numbers: Apple 1.4.1: medical apps that 'could be used for diagnosing or treating patients may be reviewed with greater scrutiny'; accuracy claims need disclosed data and methodology; apps should remind users to check with a doctor; submit the regulatory clearance link if cleared. Apple 2.3.1(a): misleading marketing is grounds for removal. Google: every developer must complete the Health apps declaration form (Play Console > App content). Apps with medical functionality must provide regulatory approval or state in the Play description that the app is 'not a medical device and does not diagnose, treat, cure, or prevent any medical condition'. Misleading health claims that contradict medical consensus are banned.
  quality: Current platform policy (binding for distribution).
  implication: Position the feature as general brain games / wellness, not a medical app. Keep store listings in all 8 locales free of prevent / treat / dementia wording. Add a one-line 'not a medical device' statement in the description and in the in-app About page. Say in the App Review notes that there are no diagnosis or treatment claims. Don't ship a 'cognitive assessment', 'dementia risk' or 'brain age' score, which would trigger 1.4.1 scrutiny.
- (design-ux-regulation #14) [corrected] 식품의약품안전처 (MFDS); 공정거래위원회 (KFTC) for 표시광고법 2026 "의료기기와 개인용 건강관리(웰니스) 제품 판단기준 (rev. 2026-02) + 의료기기법 제2조·제26조⑦ + 표시·광고의 공정화에 관한 법률 제3조·제5조·제9조" MFDS 공무원 지침서 (press release 2026-02-12); statutes on law.go.kr https://mfds.go.kr/brd/m_99/view.do?seq=49689 | guideline PDF: https://koa.or.kr/bbs/download.php?code=insurance&number=34970 | 의료기기법: https://www.law.go.kr/법령/의료기기법 | 표시광고법: https://www.law.go.kr/LSW/lsInfoP.do?lsId=002011
  claim: In Korea, software intended to prevent disease falls within the statutory definition of a medical device, and MFDS judges intended use from labeling, advertising and explanations. The 2026 wellness guideline explicitly lists software that assesses the cognitive level of people with dementia or cognitive impairment and serves tailored content to improve or treat cognition as a medical device. It allows wellness claims about maintaining 'mental acuity' when no disease is named. Separately, the Fair Labeling and Advertising Act requires any factual ad claim to be substantiated within 15 days on request.
  numbers: Guideline: a medical device is a product used '질병을 진단·치료·경감·처치 또는 예방할 목적'. '예방' means controlling risk factors so a disease does not occur or recur, and anything classified in KCD counts as a disease. Wellness covers maintaining or improving general health, including '정신적 예민함', without naming a disease. A disease may be named only for well-known lifestyle-modifiable chronic conditions; the listed examples are heart disease, hypertension, hypotension and type 2 diabetes, not dementia. The medical-device example given is '치매 등의 인지기능 장애가 있는 환자 등을 대상으로 인지기능 등을 평가·분석하고 ... 맞춤형 콘텐츠 제공(피드백)을 통해 인지 능력 개선 및 치료에 사용하는 소프트웨어'. Intended use is judged from '표시·광고, 구두 또는 서면'. 의료기기법 제26조⑦ (version in force 2024-06-14, 법률 제19457호) bans labeling or advertising a non-device so that it could be mistaken as having device-like efficacy. 표시광고법 (시행 2025-01-21, 법률 제20712호): 제3조① bans false/exaggerated, deceptive, unfair-comparison and disparaging ads; 제5조 requires factual claims to be substantiable, with materials due within 15 days of a request (③) and possible suspension of the ad if not provided (⑤); 제9조 fines of up to 2% of related sales, or up to 5억원 where there are no sales. MFDS issued an MCI DTx guideline in January 2025 with ADAS-Cog/MoCA endpoints (per news report); 실비아, 슈퍼브레인 and 코그테라 were under review.
  quality: Official MFDS guideline and primary statute text (law.go.kr PDF). The DTx details come from a trade-press report.
  implication: Allowed copy: '두뇌 활동 게임', '집중력·기억력 연습', '꾸준한 두뇌 운동 습관', '게임 기록 향상'. Banned in the app UI, store listing, push notifications, ads, social posts and support replies: '치매 예방/치료/개선/진행 지연', '경도인지장애', '인지장애 개선', '뇌 노화 방지', '치매 위험도', '뇌 나이 진단', '과학적으로 입증'. Don't target dementia or MCI patients, and don't present levels as a 인지수준 평가; our adaptive personalization plus a dementia audience is the guideline's medical-device example. Add the footer '이 기능은 의료기기가 아니며 질병의 진단·치료·예방을 목적으로 하지 않습니다.' Keep an internal claim → source file so the KFTC 15-day request can be answered. '논문 기반' may describe the method (e.g. the adaptive staircase from Kaernbach 1991), never outcomes. If the owner wants dementia or MCI claims, the only lawful route is digital therapeutics approval (RCT and MFDS approval).
  CHECKER: The guideline text checks out against the Feb 2026 MFDS PDF. It contains the device definition, the 예방/KCD wording, '정신적 예민함' as wellness, the chronic-disease examples 심장질환/고혈압/저혈압/2형 당뇨, the dementia cognitive-software example in the '의료기기인 경우' column, and '표시·광고, 구두 또는 서면'. The 표시광고법 details also check out (시행 2025.1.21, 법률 제20712호; §3①; §5 15 days and ⑤ suspension; §9 2% or 5억원). Two corrections: (1) The 의료기기법 version cited is out of date. The version now in force is [시행 2026.10.20] 법률 제22105호. The text of §26⑦ is unchanged, and §2 now explicitly lists 소프트웨어. (2) The Jan 2025 MCI DTx guideline (news report dated 2025-01-03, ADAS-Cog/MoCA) is confirmed, but 코그테라 is no longer under review. MFDS approved it on 2025-05-23 as Korea's first MCI digital therapeutic and its 7th DTx overall, for patients aged 55-85 on prescription. Also, the 2026-02-12 press release itself does not mention dementia; the dementia example appears only in the guideline PDF. (https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=291321&chrClsCd=010202&urlMode=lsInfoP&efYd=20261020&ancYnChk=0)
Open questions: No trial has compared lives / game-over against no lives in older-adult cognitive training. The lives recommendations (raise the target to 80-85%, 'two tries per level', motor mis-taps never cost a heart) are inference and should be A/B tested on completion, retention and frustration in users aged 60+. | The 85% target (Wilson 2019) is theoretical and has not been validated in humans. The success rate that best sustains motivation in older adults is unknown. | Nguyen, Murphy & Andrews 2024 (Int J Hum-Comput Interact 41(14):8624-8638, doi:10.1080/10447318.2024.2413283) reportedly covers older adults' experiences with time pressure and frustration in gamified training. The full text returned 403 and could not be checked, so it is not cited as a finding. | The 19.05 mm button recommendation of Jin, Plocher & Kiff 2007 (UAHCI, LNCS 4554, pp. 933-941) was seen only in secondary summaries and was not checked against the original. | Lampit 2014's '>3 sessions/week ineffective' and 'home-based ineffective' results compare across studies and may be confounded. Newer meta-analyses (2020+) that may update these moderators were not reviewed here. | The ACTIVE booster benefit (Coe 2026) comes from a subgroup defined by non-randomized completion and uses claims-based diagnoses. The authors caution against reading it as causal. | Would MFDS treat a neutral in-app 'research background' page that cites dementia trials, without any claim, as evidence of medical intended use? The guideline judges intended use holistically. If any dementia wording stays, consider a formal MFDS device-status inquiry (의료기기 해당 여부 질의) before launch. | Not checked: whether the 디지털의료제품법 (in force 2025) designation of '디지털의료·건강지원기기' could cover cognitive games, and what obligations that would bring. | The 의료기기법 text was read from the version in force 2024-06-14 (법률 제19457호). Later amendments to 제26조⑦ were not checked. | The scope of Google Play's 'not a medical device' disclaimer (exactly which apps must carry it) came from a paraphrased fetch. Check the wording inside the Play Console Health apps declaration form before submitting. | Color Word (Stroop) depends on telling colors apart. A palette safe for color-vision deficiency and a non-color mode need design work; prevalence data was not researched here. | Health-claim rules in other launch markets for the 8 locales (e.g. Japan's PMD Act, EU MDR, Vietnam, Thailand, Indonesia) were not researched.
