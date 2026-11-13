# 빠른 눈 재설계 명세: «안개 여행» (심사 1위안에 2·3위안의 좋은 점을 합친 판)

근거: 심사 2명 모두 «안개 여행»을 1위로 뽑았다. 아래 굵은 글씨는 심사가 치명 결함으로 지적한 부분을 고친 곳이다.
- 등불 모양 답 버튼은 쓰지 않는다. 노출된 모양과 답 버튼이 같은 그림이어야 한다.
- 연습 중 «입장 확인»으로 V1을 통과시키지 않는다. V1로 내릴지는 배치 결과로 정한다.
- V2–4 기준 150ms는 너무 빡빡하다. 모든 단계의 기준을 완화하고 «충분한 증거» 경로를 더한다.
- speedPips 식이 k=2 초반을 무시한다. k를 반영한 식으로 바꾼다.
- 공개(정답 보여 주기) 화면은 자극 층을 다시 쓰지 않고 별도 층으로 그린다.
- 렌즈 아케이드의 보스·웨이브·하트 회복·연속 배수 판돈, 창밖 여행의 «가운데 그림 계열 바꾸기», 목숨 유지는 넣지 않는다.

---

## 1) 한 줄 요약

**«가운데만 보는 이지선다(V1)에 몇 주씩 갇히는» 지금 구조를 버린다. 첫 판 30초 안에 «가운데+주변 별» 과제를 시작하고, 판을 스펙대로 중간 회색·평균 밝기 마스크로 고쳐 33–167ms가 진짜로 어렵게 한다. 매 문제 «안개가 걷히며 방금 본 장면이 드러나는» 공개, 정답 몇 개면 한 칸 빨라지는지 보이는 게이지, 장소별 진급 간주, 목숨 없는 20문제 구간으로 «보고 누르기»를 «번쩍! 맞혔나?» 게임으로 바꾼다.**

### 대표 질문 «치매랑 관련 있나?»에 대한 답 (내부용, 화면에는 쓰지 않음)
- 처리속도(주변 시야) 훈련 유형은 대규모 무작위 시험에서 장기 치매 신호가 나온 유일한 인지훈련이다. 다만 신호가 약하고 논쟁 중이다.
  - ACTIVE 10년: HR 0.71, P=.049
  - 20년 청구자료 ITT: 0.87, 유의하지 않음
  - 다중비교를 보정하면 유의하지 않다는 재분석이 있다.
- 우리 앱 자체는 검증된 적이 없다.
- 그 신호가 걸린 부분은 «가운데를 보면서 주변과 방해물 속 표적을 함께 잡는 것»이다. 지금 사용자 대부분이 머무는 V1(동그라미/네모 고르기)은 그 부분이 아니다. 그래서 대표가 «보고 누르기, 난이도 없음»이라고 느낀 것이고, 이 재설계로 근거에도 더 가까워진다.
- HR 수치와 «치매 예방» 표현은 화면·스토어·푸시·광고 어디에도 쓰지 않는다(EVIDENCE §7).

---

## 2) 플레이어가 겪는 것

### 첫 1분 (처음 하는 60세 이상 사용자, 시각은 대략값)

| 시각 | 화면 |
|---|---|
| 0:00 | **소개**: «빠른 눈». 한 줄 설명은 «가운데 모양을 보면서, 주변에 잠깐 뜬 별이 어느 쪽인지 알아차리는 연습». 데모는 실제 엔진의 V2(바닷가)이고 실제 첫 과제와 같다. 처음 한 번만 회색 한 줄 «폰을 가로로 들거나 태블릿이면 더 넓게 보여요». 큰 [시작] 버튼 |
| 0:05 | 카운트다운 3·2·1·시작(기존, 약 2.4초) |
| 0:07 | **연습 1 (V1, 500ms, 점수 없음)**: 중간 회색 판의 가운데 상자 테두리에 준비 고리가 350ms 동안 좁혀지고 150ms 멈춘다(웹은 작은 «똑», 앱은 selection 진동). 흰 동그라미가 번쩍 → 안개 마스크 500ms → 큰 버튼 2개(동그라미/네모). 공개: 방금 모양이 250ms 페이드로 다시 뜨고 따뜻한 빛 테두리와 ✓ |
| 0:11 | 연습 2 (400ms), 칩 «조금 더 빨라져요». 두 번 연달아 맞히면 연습 끝. 아니면 연습 3·4(333/267ms) |
| 0:15 | 첫 배치 시행이 V2라 기존 규칙 카드 «별도 찾아요»가 뜬다. 카드 위에 지도 띠 «나루터 ✓ → 바닷가 마을». 실제 엔진 정지 그림과 [알겠어요] |
| 0:20–0:42 | **점수 없는 V2 시행 4개**(노출 500→400→333→267ms). 가운데 질문 동안 8방향 버튼이 흐리게 미리 보인다. 가운데를 고르면 버튼이 켜지고 판 전체가 8조각 부채꼴 터치 영역이 된다. 공개에서 별이 산호색 불가사리로 물들고 동그라미가 쳐지며 «여기 있었어요». 바로 옆을 골랐으면 «아까워요, 바로 옆이었어요» |
| 0:42–1:20 | **배치 6–10문제**(V2, 267ms에서 시작, 레벨 숨김). «출발 준비 중» 점이 하나씩 찬다. 모든 문제가 별이 있는 진짜 문제다 |
| 약 1:20 | 본 구간 시작. 헤더 «바닷가 마을 · 1/3», «2단계 · 속도 레벨 5» + 속도 점 4개 + 구간 막대 20칸. 하트는 없다 |

1분 시점 상태: 12문제 중 8–9개가 «가운데+주변»이었다. 노출이 짧아지는 걸 세 번 느꼈다. 공개를 6번 넘게 봤다. 배치가 정답률 80% 지점을 찾아가므로 다섯 번에 한 번쯤은 진짜로 놓친다.

### 보통 한 판(구간)
다시 하는 사용자, V6 솔숲 산길 예시. 20문제, 약 1.8–2.2분.
- 매 문제: 준비 고리 → 번쩍 → 안개 → 가운데 → 방향(부채꼴) → 공개.
- 공개 장면: 세모는 소나무, 별은 단풍잎으로 드러난다.
- 정답 2–4개마다 «한 칸 빨라졌어요». 속도 점이 다 차면 바늘이 오른다.
- 오답: 빨간 ✕ 없이 점 하나가 비고 «이번엔 빨랐어요».
- 구간 중 진급 기준을 채우면, 시행 사이에 «새 단계: 세모가 더 많아져요» 간주(약 2초, 탭하면 넘김)가 뜨고, 새 세모 배치가 판 위에 25%로 미리 보인다.
- 구간 끝: «구간 끝» 도장 → 목표 별 3개가 하나씩 찬다(끝까지 함 / 속도 한 칸 올림 / 이 정류장 기록·통과) → 지도 띠(등불 기둥 n/4) → [한 판 더][오늘 훈련 계속].

### 2주차 (주 3회 × 2주 ≈ 6세션, 예상치라 기준값 조정 전 실측이 필요)
- **보통 60세 이상**: V4–V6. 바닷가 엽서를 받고 솔숲 산길에 도착(업적 «솔숲 산길 도착»)했다. 세모 7→15개 속 별 찾기가 «진짜 찾기»가 된다. 진급이 느린 정류장에서는 등불 기둥과 «이 정류장 최고 속도»가 판마다 목표가 된다.
- **잘 보는 사람**: 33ms 바닥에서 «최고 속도 지키기 n/14»가 차면 반전점 없이도 진급한다. V9–V11, 차밭 언덕 입구.
- **느린 사람(배치에서 V2 위치 정답률 50% 미만)**: 아무 발표 없이 V1 경로로 시작했다. V1 기준(≤100ms)을 넘어 V2–V3로 왔다.
- **매 세션**: 오늘의 훈련 첫 슬롯, 4구간 또는 10분. 판 바깥 꾸밈이 아침·낮·저녁·밤으로 바뀐다(P2).

---

## 3) 핵심 루프와 시간

| 단계 | 길이 | 화면 | 웹 소리 | 앱 진동 |
|---|---|---|---|---|
| fixation | 500ms 고정 | 0–350ms 준비 고리(크기 1.4→1.0, 불투명도 0→0.6, ease-out), 350–500ms 정지 | 0ms에 `fixationTick`(삼각파 220Hz 50ms, gain ≤0.06, 소리 설정을 따름) | 0ms에 `selectionAsync`(진동 설정을 따름) |
| stimulus | 사다리 N프레임(33–500ms) | 미리 그린 실루엣 층의 불투명도만 바꿈(기존 루프) | 무음 | 금지 |
| mask | 500ms | 판 안에만 평균 밝기를 맞춘 무작위 안개 칸 | 무음 | 금지 |
| answerCenter | 시간 제한 없음 | 동그라미/네모 버튼(웹 96px 이상, 앱 72dp 이상). V2부터 방향 버튼 8개를 opacity 0.4로 비활성 표시 | 기존 select | — |
| answerLocation | 시간 제한 없음 | 판 전체 8조각 부채꼴 + 화살표 버튼 56dp + 키 1–8. 상자 안쪽·판 밖 탭은 무시 | — | — |
| done(공개) | 정답 1000 / 절반 1400 / 오답 1600ms. 500ms 뒤부터 탭·Space로 넘기기 | 별도 공개 층이 250ms 페이드인(줄인 동작이면 즉시): 장소 색·디테일, 표적에 동그라미, 고른 방향은 흐리게, 바로 옆이면 칩 | 정답: 연속 단계별 5음계 차임. 바로 옆: E4→D4. 오답: 기존 «툭» | 정답 Light, 오답 기존 |
| void | 250ms | 공개 없이 «다시 할게요» | — | — |

- 자극 시작 간격 = 500(마스크) + 답하는 시간 + 공개(최소 500) + 500(fixation) + N이므로 항상 1.5초 이상이다(게이트는 1초 이상).
- **quiet 구간** = phase가 fixation·stimulus·mask인 동안. 칩·점수 카운트업·배지·토스트·풍경 애니메이션·소리·진동을 모두 미룬다. 예외는 fixation 진입 0ms의 준비 신호 하나뿐이다.
- **구간(라운드)** = 본 문제 20개, 목숨 없음. 끝나는 조건은 상한, 오늘의 훈련 시간 예산, 사용자 중지, 무효 연속뿐이다. 첫 판은 연습·소개·배치가 상한 밖에 붙는다.
- **새 규칙 소개 시행 4개**(V2·V5·V10·V15 처음): 점수·계단·진급 창에서 빠진다. 노출은 L−3, L−2, L−1, L(0 이상)로 내려간다.
- **진급 간주**: 시행 사이에만, 일시정지 상태(activeMs에서 제외)로 뜬다. 자동 2초 또는 탭. 새 규칙이 있으면 바로 이어 규칙 카드.
- **오늘의 훈련**: 첫 슬롯, 최대 4구간 또는 10분(`plan.ts` 그대로).

---

## 4) 첫 판부터의 체감 난이도 곡선

1. **0–40초**: 노출이 500→267ms로 두 번 짧아진다(V1 연습, V2 소개). «가운데+주변 동시 보기»가 첫 어려움이다.
2. **배치(40초–1분 20초)**: ZEST가 정답률 80% 지점을 찾는다. 판이 중간 회색이고 마스크 평균 밝기가 맞아서 잔상으로 풀리지 않는다. 100ms 아래는 정말로 «맞혔나?»가 된다. 지금은 어두운 남색 바탕 위 흰 도형이라, 마스크가 켜질 때 판 밝기가 약 10배 튀고 33ms도 쉽게 풀린다.
3. **구간 안**: 속도 점 4개와 «n개 더 맞히면 한 칸 빨라져요»가 숨은 계단을 몇 문제짜리 목표로 바꾼다. k=2 초반에는 정답 하나에 점 2개가 찬다(문구도 그만큼 정직하게).
4. **바닥(33ms)**: «최고 속도». 이때부터 정답은 «지키기 n/14»를 채우고, 다 차면 진급한다. «잘하면 못 올라가는» 함정이 사라진다.
5. **장소마다 새 손잡이 하나**:

| 장소 | 단계 | 새로 생기는 것 |
|---|---|---|
| 바닷가 | V2–4 | 고리가 안→중간→바깥으로 넓어짐 |
| 솔숲 | V5–9 | 세모 7→15→23→31→47개, 진짜 찾기 |
| 차밭 | V10–14 | 가운데 두 모양이 닮아 감(유사도 3/5/7/8/9) |
| 호수 | V15–16 | 같음/다름 판단 |

6. **진급 직후**: 노출이 3칸 쉬워지는 것(기존 Ball 2002식 완화)을 «새 길이라 처음엔 조금 천천히 보여 줘요»로 설명한다. 점수식이 단계 가중이라 문제당 점수는 오른다(+10). 그래서 퇴보로 읽히지 않는다.
7. **정답률 목표는 80% 그대로**다. 어려움은 «무엇이 화면에 나오느냐»와 «잔상 없는 짧은 노출»에서 온다.

---

## 5) 테마와 그림 (이모지·글꼴 기호 0개, 전부 기하로 그림)

### 측정 프레임 (모든 장소 공통, 테마 없음)
- **판 색**: 장소별 색조이고, 상대휘도는 모두 0.185±0.01이다.

| 장소 | 판 색 |
|---|---|
| 나루터 | `#7A766F` |
| 바닷가 | `#6E7A80` |
| 솔숲 | `#727B6C` |
| 차밭 | `#787A68` |
| 호수 | `#7A7488` |

- **잉크**는 모든 장소에서 `#F3F0E8` 하나다. 판과의 대비는 약 3.9:1로 WCAG 1.4.11 비텍스트 기준(3:1 이상)을 넘는다.
- **가운데 상자**: 판과 같은 색에 `#F3F0E8` 2dp 테두리(스펙 «중간 회색 + 고대비 테두리» 그대로).
- **가운데 모양**: 동그라미 vs 둥근 네모(기존 `shapePair` 유사도 1–9). 넓이를 맞춘다: 네모 한 변 `a = d·√((π/4)/(1−(4−π)p²))`, `p = 반지름%/100`. **답 버튼도 같은 도형**으로 그린다(등불 버튼은 쓰지 않는다).
- **별**: 정오각별, 바깥 R = stim/2, 안쪽 0.382R, 넓이 1.1227R².
  - 웹: SVG `<polygon>`.
  - 앱: 가운데 원(r 0.382R) + 스파이크 5개. 스파이크 하나 = 별 크기만 한 래퍼 View를 별 중심 기준 72°×k 회전하고, 그 안 위쪽 가운데에 border 삼각형(좌우 0.2245R 투명, 아래 0.691R 잉크)을 둔다. 래퍼가 자기 중심으로 돌기 때문에 `transformOrigin`이 필요 없다.
- **세모**: 정삼각형, 외접원 0.93R(별과 넓이가 같다, ±2%). 앱은 border 삼각형(좌우 0.8055R, 아래 1.395R, 무게중심이 슬롯 중심).
- **마스크**: 판 모양 안에만 깐다.
  - 바탕은 평균 톤이고, 그 위에 무작위 칸을 놓는다(웹 14px, 앱 18×18). 칸 모서리는 30% 둥글린다(안개 느낌, 줄무늬·체커 없음).
  - 톤 6개는 평균 ±40%(Michelson 0.40)에서 고른다. 평균 = 0.185·(1−a) + 0.872·a, a = 그 시행 잉크 넓이 ÷ 판 넓이(가운데·별·세모·상자 테두리 포함).
- **고리 안내선**: 잉크색 점선, 불투명도 0.12.

### 공개 층 (답을 다 한 뒤에만, 측정과 무관)
| 장소 | 단계 | 별 → | 세모 → | 바깥 풍경(판 밖, P2) |
|---|---|---|---|---|
| 나루터 | V1 | (없음) | (없음) | 수평선, 나루 말뚝 3개, 나룻배 실루엣 |
| 바닷가 마을 | V2–4 | 불가사리 `#E39A7A`, 팔마다 점(지름 0.12R, 0.55R 위치) | (없음) | 수평선, 등대, 갯벌 물결 선 |
| 솔숲 산길 | V5–9 | 단풍잎 `#D8694E`, 잎맥 5줄 | 소나무 `#9DAA8F`, 층 2줄 + 줄기 | 겹친 산 능선 3겹, 정자 |
| 차밭 언덕 | V10–14 | 도라지꽃 `#9F8BD6`, 꽃맥·수술 | 꽃봉오리 `#B7B48C` | 차밭 이랑 곡선 4줄 |
| 등불 호수 | V15–16 | 물에 비친 별 `#EAD27A` | 종이배 `#E9E4D8`, 접힌 선 | 호수 수평선, 등불 줄 |

- 정답 가운데 모양에는 따뜻한 빛(`#F2C46B` boxShadow 0 0 18px)이 켜진다. 앱은 RN 0.83의 `boxShadow`를 쓴다.
- 디테일은 실루엣 내접원 안에만 넣는다(RN은 도형 클리핑을 못 한다).
- **문제 문구는 늘 «별/세모»다.** 장소 이름(불가사리 등)은 공개 화면 캡션과 도감에만 쓴다. 글자 바꿔 읽는 부담을 만들지 않는다.
- 판 바깥 캔버스는 먹색 액자(`#1C1A17` 계열)다. 장소 풍경은 반투명 평면 도형으로만 그린다(앱 그라데이션 없음).
- 시간대 꾸밈(P2): 오늘의 훈련 구간 순서대로 아침→낮→저녁→밤. 판 바깥만 바꾸고 L* ±5 안으로 맞춘다.
- 마스코트·만화 동물·원색 사탕 톤은 쓰지 않는다. 수묵화풍 저채도 성인 일러스트다.

---

## 6) 피드백과 연출

### 공통 규칙
- quiet 구간(fixation·stimulus·mask)에는 아무 연출도 없다(준비 신호 하나만 예외).
- 화면 전체 흔들기, 빨간 번쩍임, 입자 폭풍은 없다. 폭죽은 기존처럼 개인 최고와 훈련 완료에만.
- 한 번에 칩은 하나만, 시행 사이에만 띄운다.
- 줄인 동작 설정이면 크기·이동·페이드·튐을 끄고 즉시 상태만 바꾼다. 색·아이콘·소리·진동은 유지한다.

### 웹 (`sfx.ts` Web Audio, 사인·삼각파, 1.3kHz 이하)
| 이벤트 | 화면 | 소리 |
|---|---|---|
| fixation | 준비 고리(CSS transition 350ms 후 정지) | `fixationTick` 220Hz 50ms |
| correct | 표적이 240ms 튐, 가운데 빛, «+N»이 900ms 떠오름, 속도 점 하나 채움 | 연속 단계별 5음계 `PENTA[min(streak,8)]` |
| nearMiss | «아까워요, 바로 옆이었어요» 칩, 고른 조각과 정답 사이 점선 호(SVG) | E4→D4 삼각파 120ms |
| wrong | 놓친 표적에 동그라미, «이번엔 빨랐어요», 점 비움 | 기존 «툭» |
| levelUp(속도 칸 오름) | «한 칸 빨라졌어요» 칩 | E5→G5 120ms |
| stageUp | 간주 오버레이: 지도 띠 이동 900ms, 도장 1.15→1(240ms), 새 판 미리보기 25% | C5-E5-G5(새 장소면 +C6 1046Hz) |
| 구간 끝 | 별이 300ms 간격으로 하나씩 참 | C5 / E5 / G5 |

### 앱 (`fx-haptics.ts`, expo-haptics만, 소리 없음)
| 이벤트 | 화면(Reanimated) | 진동 |
|---|---|---|
| fixation | 준비 고리 `withTiming` 350ms(`ReduceMotion.System`) | `selectionAsync` (노출 500ms 전) |
| correct | 튐 240ms, 빛, +N | Impact Light(기존) |
| nearMiss | 칩, 고른 화살표와 정답 화살표에 호박색 테두리 | 없음 |
| wrong | 동그라미 표시, 문구 | 기존 Warning |
| levelUp | 칩 | 없음(너무 잦음) |
| stageUp | 간주(translate 900ms, 도장 팝 240ms) | Notification Success(400ms 간격 규칙 적용) |
| 구간 끝 별 | 하나씩 참 | 별마다 Light |
| stimulus·mask | — | **금지**(기존 규칙, 시험으로 고정) |

---

## 7) 진행과 메타 (기존 등급·업적·mechanics 체계에 맞춤, 추가만 함)

- **장소(QE_PLACES)**: `dock` V1 · `shore` V2–4 · `pines` V5–9 · `tea` V10–14 · `lake` V15–16. 정거장 하나 = 단계 하나이고, 이동은 기존 «기준을 채워야 진급» 그대로다.
  - 가운데만 설정: `quickEyeTierStage` 기준으로 묶는다. V1–9는 정거장 하나, 이후는 유사도와 같음/다름 정거장. «시야»·«눈 건강» 문구는 쓰지 않는다.
- **진급 판정**(EVIDENCE [제품 결정] 개정 후):
  - (a) 기존 반전점 6개 + 최근 16문제 75% 이상 + 역치 ≤ 기준.
  - (b) **새로 추가하는 «충분한 증거» 경로**: 최근 유효 16문제가 모두 기준 이하 노출이고 14개 이상 정답이면 진급. 역치는 그 16문제 노출의 기하평균이다. 바닥 함정은 이 경로가 함께 해결한다(33ms ≤ 모든 기준이므로).
  - 기준(`QUICK_EYE_BARS_MS`): V1(가운데만·V1 경로) ≤100, V2 ≤167, V3–4 ≤200, V5–9 ≤250, V10+ ≤300ms.
- **들어가는 지점**: 새 사용자는 V2(`emptyQuickEye().variant = 2`). V1은 연습 시행으로만 쓴다. V2 배치가 끝났을 때 레벨 ≤0.5이고 배치 위치 정답률 <50%면, 발표 없이 V1 경로로 내린다. 가운데만 설정은 V1 그대로.
- **등급**(`tiers.ts`): 바꾸지 않는다. QI = (stage−1) + min(L,11)/11. V2로 시작하면 첫 안정 추정에서 QI ≥1, 곧 브론즈다(의도한 «이미 출발함» 효과).
- **업적**: id·순서·판정은 그대로(`quickEyeStage5`·`quickEyeStage10`). 문구만 «솔숲 산길 도착»(V5) / «차밭 언덕 도착»(V10)으로 바꾼다. 장소 경계와 정확히 일치한다.
- **mechanics 등록**: `MECHANICS` 배열 끝에 `{ tag: 'quickEye.clearView', game: 'quickEye', kind: 'board', from: 1, copy: 'quickEye.clearView' }` 하나만 추가한다. 기존 사용자에게 1회 «화면이 또렷해졌어요» 토스트를 띄우고 다시 맞추는 표식으로 쓴다. 새 사용자는 연습에서 조용히 «본 것»이 된다. 주석 «stage-up banner covers them»은 이제 사실이 된다.
- **구간 목표 별 3개**(정답률 별은 빠른 눈에서 쓰지 않는다):
  - ★1 구간을 끝까지 함(상한 도달)
  - ★2 본 문제 중 속도 칸이 판 시작보다 한 번 이상 오름
  - ★3 이 정류장 최고 속도 갱신(안정 추정 θ̂ 기준) 또는 이번 구간에 진급
  - 정류장별 최고값만 남기고 합산하지 않으며, 게임끼리 비교하지 않고, 별로 무엇이 열리지도 않는다.
- **등불 기둥 4개**(P2, 따로 저장하지 않음): 정류장의 기준 칸(`quickEyeBarLevel`)보다 4·3·2·1칸 아래. 정류장 최고 속도가 그 칸에 닿으면 켜진다. 성과로만 켜진다.
- **엽서·도감**(P2): variant에서 계산하므로 저장 상태가 없다. 장소를 넘으면 엽서 1장과 그 장소 표적의 도감 항목(이름, 그림, 한 줄 상식)이 열린다. 랜덤 보상·코인·마스코트는 없다.
- **저장**(작게 유지):
  - `QuickEyeProgress.field?: 2`(화면 버전)
  - `BrainMeta.qs: string`: 정류장 16칸 × base64url 한 글자, 값 = 최고속도칸×4 + 최고별(최대 51). 병합은 칸마다 속도와 별을 각각 최댓값으로.
  - 빠른 눈 «높은 변형 쪽이 이김» 병합은 그대로다.
- 합산 점수, 백분위, 연속 일수 주 지표가 없고, 주 3회를 넘긴 세션에 추가 보상이 없다.

---

## 8) 근거 게이트 체크리스트

| EVIDENCE 게이트 | 지키는 방법 |
|---|---|
| 노출 사다리 500…17ms(ms 정의), 플랫폼 하한 33ms | `QUICK_EYE_LADDER_MS`·`brain-ui.ts minExposureMs: 33` 그대로 |
| 프레임 정확 노출, setTimeout 금지, 미리 그린 층의 불투명도만 | 웹 rAF·앱 `useFrameCallback` 루프 그대로. 노출 시작 때 `stim.style.transition='none'`을 강제하고, 공개는 별도 층 |
| 무효 규칙(6프레임 이하는 정확, 그 위는 ±1), 무효는 계단·점수에서 제외, 무효율 20%면 바닥 올림 | `exposed()`·`raiseFloor` 그대로 |
| 역방향 마스크: 무작위, Michelson ≤0.5, 자극 영역만, 평균 밝기 일치, 500ms | **이번에 실제로 지킨다**: `quickEyeMaskTones`(0.40, 평균 ±3%), 판 안에만, 시험으로 고정 |
| 고정 상자: 중간 회색 + 고대비 테두리 | 판 색 휘도 0.185 + `#F3F0E8` 2dp 테두리 |
| 가운데 2지선다, 유사도 1–9, V15+ 같음/다름 | `shapePair`·변형표 그대로. 넓이를 맞춰 밝기 단서 제거 |
| 주변 8방사선 × 고리 3개, V2부터 둘 다 맞아야 정답 | `outcome()` 그대로(`nearMiss`는 표시용) |
| 방해물: 같은 크기·밝기, 모양으로 구분, 최대 47(폰 39) | 별과 세모 잉크 넓이 ±2%(시험), 단색 잉크 |
| 변형 순서 | `QUICK_EYE_VARIANTS` 그대로. 들어가는 지점만 V2([제품 결정], free «시작점») |
| 기준을 채워야 진급 | 반전점 경로 + 충분한 증거 경로. 기준값은 [제품 결정](#33·#36 개정) |
| 가중 상하법 +0.25/−1.0, 목표 80%, k는 위아래에 같이 곱함 | `rules.ts`·`skill.ts` 그대로. `brain-games.test.ts:209-231` 통과 |
| 답 시간 제한 없음, 반응속도 보너스 없음 | `timeLimitMs: null`, 빠른 눈 `fast=false`. 점수식에 반응시간 없음 |
| 역치는 반전점 6개 이상(또는 충분한 증거 경로) | `quickEyeThreshold` 그대로, 새 경로는 문서에 명시 |
| 수준 이월, 레벨 1로 되돌리지 않음 | `restartLevel` 그대로. 진급 −3 유지, 화면 버전 변경 시 1회 −2 |
| 새 규칙마다 점수 없는 시행 4회 이상 | `introLeft 4` 유지(노출만 L−3에서 내려감). V1 연습 2–4회 유지 |
| 배치 결과 비공개, 배치는 진급 창 밖 | 그대로. V1 경로 결정도 발표하지 않음 |
| 첫 슬롯, 4구간 또는 10분, 주 3회 | `plan.ts` 그대로 |
| ms·역치·규준 비표시, «N단계 · 속도 레벨 L»만 | 게이지는 «정답 n개» 단위. 장소 이름은 허용된 «단계/지역» 포장 |
| 합산 두뇌 점수·백분위·평가 문구 금지 | 별은 정류장별 최고값만, 합산 없음 |
| 건강 주장·HR 수치 금지(8개 로케일) | 문구는 «알아차리는 연습» 수준. 8개 로케일 검토 |
| 상표 금지 | UFOV·Double Decision·BrainHQ·Road Tour 없음 |
| 깜박임 1초 3회 이하, 시행 간격 1초 이상, 빨간 섬광 금지, 줄인 동작 | 공개는 페이드만, 간격 1.5초 이상(시험), 마스크 밝기 점프 감소, 출시 전 PEAT/Harding |
| 목숨 구매·레벨 1 되돌리기·칸 밖 탭으로 목숨 차감 금지 | 목숨 자체가 없음(A/B용 설정값은 남김), 칸 밖 탭 무시 |
| 하트·카운트다운·빨간 번쩍임·GAME OVER 동시 금지 | 하트 제거, «구간 끝» |
| 가운데만 설정, «시야» 표현 금지 | 유지, 지도도 tier stage로 묶음 |
| 노출 중 일시정지 불가, 재개하면 fixation부터 | 그대로. 간주는 시행 사이에만 |
| 앱 네이티브 모듈 추가 금지, 노출 중 진동 금지 | View/Reanimated/expo-haptics만. fx 시험 |
| 진행 기록 약 2KB, 병합 규칙 | `field` + `qs` 16자, 크기·병합 시험 |

**문서 먼저** (코드보다 앞에 고친다):
- EVIDENCE.md §2.3: 들어가는 지점 V2와 배치 기반 V1 경로, 기준표, 충분한 증거 경로, 판 휘도 0.185·마스크 평균 일치 구현 메모, 준비 신호(경계 alerting 요소라 역치가 조금 낮아질 수 있음), 공개 길이, 소개 시행 노출, 점수식.
- §4.2: 빠른 눈 20문제·목숨 없음, 목숨 수는 #44 A/B 설정값. **80% 목표의 근거 문장(EVIDENCE.md:129·582 «목숨 모드라서 75%보다 높였다»)을 [제품 결정]으로 다시 쓴다.**
- #33·#36·#37·#44에 주석.
- GAME_LOGIC.md의 진급 행·라운드 순서, GAME_FEEL.md의 빠른 눈 절(quiet, 공개, 간주, 신호).

---

## 9) 엔진 변경 (`packages/shared`)

**P1 = 핵심(재미·난이도), P2 = 지도·별·엽서·풍경.**

### `lib/brain-games/games/quick-eye.ts` (P1)
- `advanceBarMs` → 표 `QUICK_EYE_BARS_MS`: V1 100, V2 167, V3–4 200, V5–9 250, V10+ 300.
- `quickEyeAdvance(variant, shownMs, ok)`: 반전점 경로 앞에 충분한 증거 경로를 넣는다. `last16.every(ms => ms <= bar + 1) && correct >= 14` → `{ advance: variant < MAX, thresholdMs: round(geomean(last16)) }`.
- `quickEyeBarLevel(variant)`: `QUICK_EYE_LADDER_MS[i] <= bar`인 가장 작은 i(V1 7, V2–4 5, V5–9 4, V10+ 3).
- `quickEyeHold(recentMs, recentOk, variant)` → `{ filled, run }`. 기준 이하 노출이 연달아 나온 꼬리 구간(최대 16) 안의 정답 수이고, 표시는 n/14.
- `view()`에 `variant`를 더하고, done일 때 `nearMiss`(|picked−target|를 원형으로 잰 거리가 1)를 더한다. `mechanics()`는 늘 `'quickEye.clearView'`를 넣는다. `exposed`·`outcome`·`timeLimitMs`·`solution`·`signature`·`FIXATION_MS`·`MASK_MS`는 손대지 않는다.

### `types.ts` (P1)
- `QuickEyeView += variant: number; nearMiss?: boolean`.

### 새 파일 `lib/brain-games/games/quick-eye-art.ts` (P1)
- `QE_STAR`(10점, R=1, 안쪽 0.382), `QE_STAR_SPIKE`({halfBase 0.2245, height 0.691, apothem 0.309}), `QE_STAR_CORE_R = 0.382`, `QE_TRIANGLE`(외접원 0.93).
- `centerShapeScale(shapeId)`, `QE_INK = '#F3F0E8'`, `QE_FIELD_TINT: Record<QePlaceId,string>`, `QE_WARM = '#F2C46B'`.
- `relLum(hex)`, `quickEyeInkFraction(view, geo, fieldArea)`, `quickEyeMaskTones(inkFraction, tint)` → 6색(선형 휘도 평균 일치, Michelson 0.40).
- `quickEyeMaskCells(seed, cols, tones)` → `{x, y, tone}[]`(톤별 등확률, 영역 가중 평균을 시험으로 고정).
- `QE_REVEAL_ART[place]` → { 별 색·디테일 기술자, 세모 색·디테일 }.

### 새 파일 `lib/brain-games/quick-eye-journey.ts`
- (P1) `QE_PLACES`, `quickEyePlace(variant, centerOnly)` → `{ id, stop, stops }`.
- (P1) `quickEyeSpeedGauge(level, k, maxLevel)` → `{ shown: clamp(round(L),0,11), pips: clamp(floor((L-(round(L)-0.5))/0.25),0,3), toNext: ceil((round(L)+0.5-L)/(0.25*k) - 1e-9), atTop: round(L) >= maxLevel }`.
- (P2) `legStars({ finished, rungUps, thetaRung, stopBest, advanced })`, `postsLit(bestRung, barRung)`, `encodeStops`·`decodeStops`·`mergeStops`.

### `progress.ts` (P1)
- `emptyQuickEye()` → `{ variant: 2, …, field: 2 }`.
- `parseProgress`: `qe.field !== 2`(옛 기록)이면 recentMs·recentOk 비우고 thresholdMs=null. variant===1이고 `!settings.centerOnly`면 2로. `bestRuns.quickEye`를 1회 지우고 `field: 2`를 둔다. 여러 번 읽어도 결과가 같다(멱등). settings 파싱 뒤에 둔다.
- `recordRound`: 그대로(bars는 quick-eye.ts에서).

### `meta.ts`·`sync.ts` (P2)
- `BrainMeta.qs: string`(기본 ''), parse/serialize, meta 병합에 `mergeStops`.

### `rules.ts` (P1)
- `GROUP_RULES.quickEye = { lives: 0, up: 0.25, down: 1.0, roundCap: 20, min: 0, max: 12, restartDrop: 1.0 }`. `lives: 0`은 «목숨 없음»이다. 머리 주석을 고친다.

### `adaptive.ts` (P1)
- `quickEyeBase(variant, level) = 10 + 10·round(level) + 40·(variant−1)`. 진급할 때 +40−30=+10이라 줄지 않는다. V1·L11은 120.

### `mechanics.ts` (P1)
- 끝에 `quickEye.clearView` 추가(추가만), 주석 정정.

### `demo.ts` (P1)
- 빠른 눈 데모 variant = `centerOnly ? 1 : clamp(ctx.variant ?? 2, 2, 16)`.

### `stores/brain-store.ts` (P1)
- 액션 `setQuickEyeVariant(v)`: recentMs·recentOk 비움(V1 경로 내리기 전용).

### `hooks/useBrainRound.ts` (P1)
- **연습**: 빠른 눈은 V1로 만들고(`buildCtx(..., 1)`), 노출은 `[0,1,2,3][practiceDone]`. 빨리 끝내기(2연속)는 그대로.
- **소개 시행**: `introduce()`가 빠른 눈 규칙 카드를 걸면 `introBase = level`을 저장하고, 카드가 걸린 시행을 같은 seed·ctx로 `max(0, introBase−3)`에서 다시 만든다. 다음 소개 시행은 `max(0, introBase−3+i)`.
- **배치**: 빠른 눈 `minTrials 6 / maxTrials 10`. 배치 위치 정답 수·시행 수를 State에 센다. 넘겨줄 때 `level ≤ 0.5 && locOk/locN < 0.5 && !centerOnly && variant === 2`면 `store.setQuickEyeVariant(1)`.
- **화면 버전 재조정**: init에서 `gp.rounds > 0 && !hasBit(meta.seen, bit('quickEye.clearView'))`면 `level = max(0, level − 2)`, `sd = SKILL.quickEye.sd0`.
- **목숨 0 처리**:
  - judge의 livesLost는 `rules.lives > 0`일 때만.
  - 결과 effect: `rules.lives > 0 && cur.lives <= 0`일 때만 'lives' 종료.
  - 'end'의 clean 보너스는 `rules.lives > 0`일 때만.
- **점수와 연속**: 빠른 눈 `rawBase = quickEyeBase(variant, level)`, 연속 배율은 기존. 연속은 accuracy 0.5면 유지(증가도 끊김도 없음).
- **진급 간주**: State에 `stageUp: { from, to, place, newPlace, ruleFollows, id } | null`. 'next'에서 `action.variant > state.variant`이고 배치가 아니면 설정하고 paused. `ackStageUp`은 stageUp을 풀되, intro가 남아 있으면 계속 paused.
- **공개와 넘기기**: `REVEAL.quickEyeRight 1000`, `quickEyeHalf 1400`, `quickEyeWrong 1600`. `resultAt`을 두고 액션 `skipReveal`(결과 뒤 500ms가 지나야 받음)을 추가해 지연 effect를 즉시 실행한다.
- **기록**: `rungUps`(본 문제에서 round(L)이 오른 횟수), `legMarks`('ok'|'half'|'miss').
- (P2) `finishRound`: `legStars`를 계산하고 `meta.qs[variant-1]`을 최댓값으로 갱신. 반환에 `legGoals`.
- **반환 추가**:
  - `quiet` = 빠른 눈이고 phase ∈ {fixation, stimulus, mask}
  - `speed` = `quickEyeSpeedGauge(level, stepMultiplier('quickEye', sd), cap)`(배치·연습 중에는 null)
  - `hold`(atTop일 때만)
  - `place`, `legMarks`, `stageUp`, `ackStageUp`, `skipReveal`, `legGoals`

### `hooks/useBrainFx.ts` (P1)
- 추가: `{kind:'fixation'}`(빠른 눈 fixation 진입, 데모 제외), `{kind:'nearMiss'}`, `{kind:'stageUp'; variant; newPlace}`.
- 기존 `'stimulus'`는 계속 무음·무진동.
- stimulus·mask 동안에는 다른 이벤트를 내지 않는다.

---

## 10) 웹 변경 (`packages/web/src`)

- **`components/brain/QuickEyeBoard.tsx`**
  - 판 배경을 `QE_FIELD_TINT[place]`로 바꾸고 radial-gradient 남색을 걷어 낸다. 상자는 같은 톤 + 잉크 2px 테두리, 고리 안내선은 잉크 점선 0.12.
  - 자극: ★/▲ `<span>`을 새 `QeShapes.tsx`(SVG `Star`/`Triangle`/`CenterShape`, fill `QE_INK`, `centerShapeScale`)로 바꾼다. rAF 루프·`onExposure`는 그대로 두고, 루프 시작에 `stim.style.transition='none'`.
  - 마스크: canvas를 판 모양으로 clip하고, 평균 톤으로 채운 뒤 `quickEyeMaskCells(randomSeed, cols, quickEyeMaskTones(quickEyeInkFraction(...), tint))`로 둥근 칸을 그린다. 시행마다 다시 그린다.
  - 준비 고리: fixation 진입 때 CSS transition 350ms(scale 1.4→1, opacity 0→0.6). `bfx-glow`는 제거. 줄인 동작이면 opacity만.
  - **공개 층**: 별도 `div+svg`. `phase==='done' && !void`일 때만 opacity 0→1(250ms). `QE_REVEAL_ART` 색·디테일, 표적 동그라미, 고른 조각 흐리게, `nearMiss` 칩, 정답 가운데 빛. 판을 클릭하거나 Space/Enter면 `r.skipReveal()`.
  - 답 화면: answerCenter 동안 방향 버튼 opacity 0.4·disabled. answerLocation에서 판 `onPointerDown` → `dir = ((round(atan2(dx,−dy)/(π/4)) % 8) + 8) % 8`. 상자 반지름+8px 안쪽과 R+28px 바깥은 무시. 고른 조각은 반투명 부채꼴로 강조. 화살표 버튼과 키 1–8 유지.
- **`RoundView.tsx`**
  - 빠른 눈 헤더: 장소 칩 «바닷가 마을 · 1/3» + 기존 «N단계 · 속도 레벨 L» + 속도 점 4개(aria-label = `quickEye.gauge`). atTop이면 «최고 속도 · 지키기 n/14».
  - `r.maxLives === 0`이면 하트 대신 구간 막대 20칸(ok 꽉 참 / half 반 / miss 빈 칸, 빨간색 없음).
  - `StageUpInterstitial`: 지도 띠, 장소 제목, 손잡이 한 줄, 완화 한 줄, 새 판 25% 미리보기(`QuickEyeBoard demo`, `ruleFollows`면 미리보기 없음), [계속], 2초 자동. 이어서 규칙 카드.
  - 칩·카운트업·토스트는 `r.quiet` 동안 큐에 넣었다가 끝나면 푼다.
- **`RuleCard.tsx`**: `quickEye.periphery`이고 첫 판이면 위에 지도 띠 «나루터 ✓ → 바닷가 마을».
- **`RoundSummary.tsx`(빠른 눈)**: «구간 끝», 목표 별 3개(이름과 함께 300ms 간격, P2), 속도 레벨 시작→끝, 지도 띠와 등불 기둥(P2), «다음 목표: 속도 레벨 {bar} 근처를 꾸준히». 정답률 별은 없다.
- **`GameIntro.tsx`**: `buildDemo('quickEye', { variant: progress.quickEye.variant, centerOnly })`, 새 설명 문구, 처음 한 번 가로·태블릿 안내(localStorage 플래그, try/catch).
- **`GameCanvas.tsx`(P2)**: 빠른 눈일 때 판 바깥 장소 풍경(CSS 층·clip-path)과 시간대 꾸밈. `React.memo`, quiet 동안 `animation-play-state: paused`.
- **`sfx.ts`**: `fixationTick`, `rungUp`, `nearMiss`, `stageUp(newPlace)`, `legStar(i)`. 전부 1.3kHz 이하(C6 1046Hz만 예외적으로 허용 범위 안), 기존 소리 설정을 따른다. quiet 중 들어온 요청은 버린다(`fixationTick`은 예외).
- **새 `QuickEyeJourney.tsx`(P2)**: 세로 지도, 장소 5개 × 정거장, 도장(도착/통과), 정거장별 최고 속도·별, 등불 기둥, 엽서, 도감. GameIntro와 RoundSummary에서 연다.

---

## 11) 모바일 변경 (`packages/mobile/src`)

- **`components/brain/QuickEyeBoard.tsx`**
  - `styles.field` 배경을 `QE_FIELD_TINT[place]`로(borderRadius 24 유지, `overflow:'hidden'`). 상자는 같은 톤 + `QE_INK` 2dp 테두리.
  - `Glyph`(★/▲ Text)를 새 `QeShapes.tsx`로 바꾼다.
    - `Star` = 가운데 원 View + 별 크기 래퍼 5개(`rotate: 72k deg`, 기본 원점) 안의 border 스파이크.
    - `Triangle` = border 삼각형 1개.
    - `CenterShape` = 넓이를 맞춘 원/둥근 네모.
  - `useFrameCallback`·`stimOpacity`/`maskOpacity` 경로는 그대로다.
  - 마스크: 평균 톤 바탕 View 1개 + `quickEyeMaskCells`의 18×18 둥근 칸(borderRadius 30%). `useMemo`, 보드가 시행마다 다시 마운트되므로 매번 새 무늬.
  - 준비 고리: `withTiming` 350ms. 노출 시작 150ms 전에 끝난다.
  - **공개 층**: done이고 void가 아닐 때만 `Animated.View`를 마운트하고 opacity `withTiming` 250ms. 디테일은 내접원 안의 작은 View들, 빛은 `boxShadow`. 노출 층에는 `withTiming`을 절대 걸지 않는다.
  - 답 화면: 방향 버튼 0.4·disabled 미리보기. answerLocation에서 판 덮개 `Pressable`의 `nativeEvent.locationX/Y`로 같은 식을 쓴다. 상자 안·판 밖 탭 무시. 56dp 화살표와 `accessibilityLabel quickEye.dir.*` 유지. 공개 중 판 탭이면 `skipReveal`.
- **`RoundView.tsx`**: 웹과 같은 헤더·속도 점·지키기·구간 막대·`StageUpInterstitial`(Reanimated translate 900ms, 도장 팝 240ms). 칩은 `adjustsFontSizeToFit`·`numberOfLines 2`·`maxFontSizeMultiplier 1.3`. `r.quiet` 동안 setState로 칩·카운트업을 띄우지 않는다(노출 순간 JS 부하 방지).
- **`fx-haptics.ts`**: fixation → `selectionAsync`, stageUp → `notificationAsync(Success)`, 별 → Light, nearMiss·levelUp → 없음. stimulus·mask 진동 금지, 최소 간격 80ms, 앱 진동 설정을 머리 주석과 시험으로 고정.
- **`RoundSummary.tsx`·`GameIntro.tsx`·`DemoPlayer.tsx`**: 웹과 같은 내용. 데모에 variant를 넘긴다.
- **`GameCanvas.tsx`(P2)**: 장소 풍경을 기존 CanvasBackdrop 방식(반투명 원·회전 사각형)으로. memo, quiet 동안 애니메이션 정지.
- **새 `QuickEyeJourney.tsx`(P2)**: ScrollView + View, SVG 없음.
- 네이티브 모듈 추가 없음(RN core, Reanimated, expo-haptics). JS·JSON만 바뀌므로 OTA로 낼 수 있다.

---

## 12) i18n 키 (8개 로케일 × 웹 `public/locales/*/brain.json` + 앱 `src/i18n/locales/*/brain.json`)

| 키 | ko | en |
|---|---|---|
| `games.quickEye.desc`(수정) | 가운데 모양을 보면서, 주변에 잠깐 뜬 별이 어느 쪽인지 한눈에 알아차리는 연습이에요. | Watch the centre shape and catch, at a glance, which way the star flashed. |
| `quickEye.places.dock.name` | 나루터 | The Ferry Dock |
| `quickEye.places.shore.name` | 바닷가 마을 | Seaside Village |
| `quickEye.places.pines.name` | 솔숲 산길 | Pine Trail |
| `quickEye.places.tea.name` | 차밭 언덕 | Tea Hills |
| `quickEye.places.lake.name` | 등불 호수 | Lantern Lake |
| `quickEye.places.{shore,pines,tea,lake}.target` | 불가사리 / 단풍잎 / 도라지꽃 / 물에 비친 별 | starfish / maple leaf / balloon flower / star on the water |
| `quickEye.places.shore.codex` | 팔이 다섯 개라 별처럼 보여요. 잘린 팔이 다시 자라기도 해요. | Five arms make it look like a star; some can regrow a lost arm. |
| `quickEye.places.pines.codex` | 가을이 되면 잎의 초록빛이 빠지고 붉은 색소가 새로 생겨요. | In autumn the green fades and new red pigment appears. |
| `quickEye.places.tea.codex` | 꽃잎 다섯 장이 별처럼 벌어지고, 봉오리는 풍선처럼 부풀어요. | Five petals open like a star; the bud puffs up like a balloon. |
| `quickEye.places.lake.codex` | 바람 없는 밤, 잔잔한 호수는 하늘을 거울처럼 비춰요. | On a still night, a calm lake mirrors the sky. |
| `quickEye.knob.wider` | 이번엔 더 넓게 보기 | Now look wider |
| `quickEye.knob.ring2` / `ring3` | 중간 고리까지 / 바깥 고리까지 | Out to the middle ring / Out to the outer ring |
| `quickEye.knob.crowd` | 세모 사이에서 별 찾기 | Find the star among triangles |
| `quickEye.knob.moreCrowd` | 세모가 더 많아져요 | More triangles |
| `quickEye.knob.similar` | 가운데 모양이 더 닮아요 | The centre shapes look more alike |
| `quickEye.knob.sameDiff` | 같을까, 다를까 | Same or different? |
| `quickEye.stageUp.title` | 새 장소: {{place}} | New place: {{place}} |
| `quickEye.stageUp.stage` | {{stage}}단계 | Stage {{stage}} |
| `quickEye.stageUp.ease` | 새 길이라 처음엔 조금 천천히 보여 줘요 | A new path starts a little slower |
| `quickEye.stageUp.continue` | 계속 | Continue |
| `quickEye.leg` | {{n}}/{{of}}구간 | Leg {{n}}/{{of}} |
| `quickEye.gauge` | {{count}}개 더 맞히면 한 칸 빨라져요 | {{count}} more right and it gets faster |
| `quickEye.speedUp` | 한 칸 빨라졌어요 | One step faster |
| `quickEye.topSpeed` | 최고 속도 | Top speed |
| `quickEye.hold` | 최고 속도 지키기 {{n}}/14 | Hold top speed {{n}}/14 |
| `quickEye.wasHere` | 여기 있었어요 | It was here |
| `quickEye.nearMiss` | 아까워요, 바로 옆이었어요 | So close, right next to it |
| `quickEye.missFast` | 이번엔 빨랐어요 | That one was quick |
| `quickEye.slowerStart` | 조금 더 빨라져요 | A little faster now |
| `quickEye.legEnd` | 구간 끝 | End of leg |
| `quickEye.goals.finish` / `speed` / `record` / `pass` | 구간 끝까지 / 속도 한 칸 올리기 / 이 장소 기록 넘기기 / 다음 단계로 | Finish the leg / Go one step faster / Beat this stop's best / Reach the next stage |
| `quickEye.nextGoal` | 다음 목표: 속도 레벨 {{level}} 근처를 꾸준히 | Next: stay near speed level {{level}} |
| `quickEye.journey.title` | 빠른 눈 여행 지도 | Quick Eye journey |
| `quickEye.journey.practiceDone` | 연습 ✓ | Practice ✓ |
| `quickEye.journey.arrived` / `passed` | 도착 / 통과 | Arrived / Passed |
| `quickEye.journey.best` | 최고 속도 {{level}} | Best speed {{level}} |
| `quickEye.journey.posts` | 등불 {{n}}/4 | Lanterns {{n}}/4 |
| `quickEye.journey.postcard` | {{place}} 엽서 | {{place}} postcard |
| `quickEye.landscapeHint` | 폰을 가로로 들거나 태블릿이면 더 넓게 보여요 | Turn your phone sideways or use a tablet for a wider view |
| `quickEye.revealA11y` | 정답: {{center}}, 별은 {{dir}} | Answer: {{center}}, star {{dir}} |
| `quickEye.warmup` | 출발 준비 중 | Getting ready |
| `mechanics.quickEye.clearView.title` | 화면이 또렷해졌어요 | A clearer screen |
| `mechanics.quickEye.clearView.body` | 가림막이 바뀌어서 처음 몇 문제는 조금 천천히 시작해요. | The cover changed, so the first few start a little slower. |
| `achievements.quickEyeStage5.title/body`(수정) | 솔숲 산길 도착 / 빠른 눈 5단계, 솔숲 산길에 닿았어요. | Pine Trail reached / Quick Eye stage 5: you reached the Pine Trail. |
| `achievements.quickEyeStage10.title/body`(수정) | 차밭 언덕 도착 / 빠른 눈 10단계, 차밭 언덕에 닿았어요. | Tea Hills reached / Quick Eye stage 10: you reached the Tea Hills. |

- ja·zh·vi·th·id·es는 같은 뜻으로 번역한다. 숫자는 Intl. 태국어·베트남어는 두 줄을 허용한다.
- «검사·뇌·시야·치매·향상·효과» 같은 단어는 8개 로케일 모두 금지(검토 체크리스트).

---

## 13) 추가할 시험 (`packages/web/src/lib/__tests__/` 기존 파일에 추가)

1. `brain-games.test.ts:189-191`의 기준값 갱신: `advanceBarMs(1)=100`, `(2)=167`, `(7)=250`, `(12)=300`.
2. **충분한 증거 경로**: V3에서 16문제가 모두 33ms이고 15개 정답이면 진급, 실수 3개면 진급 안 함, 16문제 중 하나라도 기준을 넘으면 진급 안 함.
3. 기존 V2→V3 진급 시험(196–205)이 새 기준에서도 통과하고 레벨 −3을 유지한다.
4. `parseProgress`: field가 없는 V1 기록은 V2로 올리고 창을 비우며 bestRuns.quickEye를 지운다. 가운데만 설정은 V1 유지. field 2 V1(배치 경로) 기록은 그대로. 두 번 파싱해도 같다.
5. 계단 80% 수렴 시험(209–231) 통과(목숨 0·상한 20에서도).
6. **목숨 0**: 오답 20개여도 'lives'로 끝나지 않고 상한에서 'cap'. clean 보너스 0.
7. `quickEyeBase`: 진급(V+1, L−3) 전후로 줄지 않는다. V1·L11은 120.
8. `quickEyeSpeedGauge`: k=1과 k=2에서 toNext가 실제 `stepLevel` 몇 번 뒤에 round(L)+1이 되는지와 같다(0–11 전 구간). atTop은 maxLevel에서.
9. **마스크**: `quickEyeMaskTones`가 Michelson 0.5 이하이고, `quickEyeMaskCells` 영역 가중 평균이 목표의 ±3% 안(a=0.02–0.15). 무작위 시드 100개에서 규칙 패턴 없음(행·열 자기상관 < 0.2).
10. **도형**: 별과 세모 넓이 차 2% 이내, 가운데 쌍(유사도 1–9) 넓이 차 1% 이내, 판 색 5개의 휘도가 0.185±0.01, 잉크 대비 3:1 이상.
11. `brain-round-hook.test.ts`:
    - 빠른 눈 첫 판 흐름: V1 연습 → V2 첫 시행에 periphery 카드 → 소개 시행 4개의 노출 레벨이 [0,1,2,3] → 배치.
    - 소개·연습·배치 시행은 `recentMs`에 들어가지 않는다.
    - 배치 V1 경로 조건(레벨 ≤0.5, 위치 <50%)에서 `setQuickEyeVariant(1)` 호출.
    - 진급하면 `stageUp`이 서고 paused. `ackStageUp` 뒤 규칙 카드가 남아 있으면 계속 paused.
    - `skipReveal`은 500ms 전에는 무시하고 뒤에는 바로 다음.
    - 가짜 시계로 자극 시작 간격이 1000ms 이상(정답·넘기기 최단 경로에서도).
    - 절반 정답은 연속 유지.
12. **fx**: stimulus·mask 동안 `useBrainFx`가 낸 이벤트는 기존 `'stimulus'`뿐이다. `fx-haptics`와 `sfx`가 `'stimulus'`를 무음·무진동으로 처리한다. `'fixation'`은 fixation 진입에서 한 번만.
13. **기록 크기**(425–426): `field`·`qs` 포함으로 progress 약 1KB, meta 2KB 미만. `brain-sync.test.ts`: `mergeStops` 칸별 최대, 높은 변형 우선 병합 유지.
14. `solution()` 자동 풀이: 16변형 × 가운데만 on/off에서 공개 층·nearMiss가 정답을 바꾸지 않는다.
15. 데모: `buildDemo('quickEye', {variant: 7})`이 V7, 가운데만이면 V1, variant가 없으면 V2.

---

## 14) 위험과 브라우저·시뮬레이터 확인 항목

### 위험
- **대비 변경으로 역치가 오른다.** 기준을 완화해도 노인 중앙값(강원 UFOV2 평균 286ms)은 V2–V4에서 오래 머물 수 있다.
  - 대응: 기준을 `QUICK_EYE_BARS_MS` 한 곳에 둔다. 출시 전 qe-sim(실제 엔진 함수, 유형별 40명 × 16구간)을 새 기준으로 다시 돌려 «V5 도달 구간 수»를 PR 본문에 적는다. 출시 후 «중앙값 1–2세션에 단계 1개»로 조정한다. 정류장별 최고·등불 기둥이 정체 구간을 받친다.
- **문서 불일치**: §2.3·§4.2·#33·#36·#37·#44와 80% 근거 문장을 먼저 고치지 않으면 게이트 위반이다.
- **준비 신호(경계 alerting)** 때문에 역치가 조금 좋게 나올 수 있다. 매 시행 같아 계단 비교는 유지된다. 문서에 적고, 기존 소리·진동 설정으로 끌 수 있다.
- **목숨 제거**: 세션당 본 문제 수가 4구간 × 20 ≈ 80이 된다(지금은 대부분 기회 소진으로 15–30에서 끝남). #44 A/B용 `lives` 설정값은 남기고, 효과 주장의 근거로 쓰지 않는다.
- **V1을 건너뛰는 해석**: «모든 변형 기준 통과»를 약하게 해석했다는 비판이 가능하다. 대응: V1 바닥 효과 근거(UFOV1 대부분 32ms 이하)를 문서화하고, 배치 기반 V1 경로와 가운데만 설정을 남긴다.
- **저사양 Android 프레임 누락**: 공개 층·고리·풍경이 노출 순간의 프레임을 빼먹으면 무효율이 오르고 바닥이 올라간다. 대응: quiet, memo, 공개 층은 done에서만 마운트. 기기별 무효율을 확인한다.
- **연출 과잉**: 칩은 하나씩, 흔들기·폭죽 남용 금지, 줄인 동작 존중.
- **번역 길이**(태국어·베트남어·스페인어)로 헤더가 넘칠 수 있다. 판 위에는 노출 중 글자를 두지 않는다.
- **최고 기록 초기화**(bestRuns.quickEye 1회 삭제): 첫 판에 «개인 최고» 연출이 나오지 않는지(첫 판과 같은 동작인지) 확인한다.
- 폰 세로 화면의 바깥 고리(약 5°)는 그대로다. 가로·태블릿 안내만으로 부족할 수 있다.
- 출시 전 PEAT 또는 Harding 광과민 검사를 다시 한다(공개 페이드·풍경 추가, 마스크 밝기 점프는 줄어듦).

### 확인 (웹은 Claude in Chrome으로 직접 열어 화면·콘솔을 본다. 앱은 iOS 시뮬레이터와 Android 에뮬레이터 스크린샷)
1. **첫 판 흐름**: 소개 데모 V2 → 연습 V1 2–4개(노출 짧아짐) → periphery 카드 + 지도 띠 → 소개 4개(500→267) → 배치 → 본 구간 20문제. 하트가 없고 구간 막대가 보인다. 콘솔 오류 0.
2. **판·마스크**: 판이 중간 회색이고 마스크가 켜질 때 판 밝기가 튀지 않는다(눈으로, 그리고 스크린샷 평균 픽셀 휘도를 판·노출·마스크 세 프레임에서 비교해 ±5% 안). 줄무늬·체커 없음.
3. **도형**: 웹·iOS·Android 세 곳에서 별(오각)과 세모 모양·크기가 같다. 별 스파이크 이음매에 틈이 없다. 가운데 동그라미와 네모의 크기가 같아 보인다.
4. **노출 정확도**: 60Hz·120Hz 기기에서 33·50·67ms 시행 무효율(웹 devtools 로그, 앱 개발 로그)이 바뀌기 전보다 늘지 않는다.
5. **공개**: 정답·절반·오답·바로 옆 네 경우의 화면과 길이, 500ms 뒤 탭 넘기기, 줄인 동작에서 즉시 표시.
6. **게이지**: 첫 판 k=2 구간에서 «n개 더» 문구와 점이 실제 칸 상승과 맞는다. 33ms에서 «최고 속도 · 지키기 n/14»가 차고, 다 차면 진급 간주가 뜬다.
7. **진급 간주**: V2→V3(미리보기 있음), V4→V5(장소 전환 → 규칙 카드), V9→V10 순서와 일시정지(시간 예산에서 빠짐).
8. **기존 사용자 이전**: 옛 V1 기록(필드 없음)을 넣고 열면 V2, periphery 카드, «화면이 또렷해졌어요» 토스트, 레벨 −2. 옛 V7 기록은 창이 비고 −2, 단계 유지.
9. **가운데만 설정**: 주변 없음, V1 경로, 지도가 tier stage로 묶임, «시야» 문구 없음.
10. **8개 로케일**: 헤더·칩·간주·요약 줄바꿈과 잘림(320pt 폭, fontScale 200%).
11. **앱 진동**: fixation 시작에만 selection, 노출·마스크 중 진동 0, 진급 Success. 진동 설정을 끄면 0.
---

## 구현 범위 (2026-11-13 대표 결정 반영 — 이 절이 위 내용보다 우선)

대표: «RPG·메타 게임은 필요 없고 간단한 두뇌 게임». 그래서 **P2 전부와 메타 성격 요소는 만들지 않는다**:
여행 지도(`QuickEyeJourney`), 엽서·도감, 등불 기둥, 정류장별 기록 `BrainMeta.qs`, 구간 목표 별 3개(`legStars`), 판 바깥 장소 풍경·시간대 꾸밈, 장소 이름 업적 문구 변경.

**만드는 것(P1)**: 연습 V1 → 첫 배치·본 문제는 V2부터(V1 경로는 배치로만) · 판 중간 회색(휘도 0.185)·잉크 단색·평균 밝기 마스크 · 충분한 증거 진급 경로 + 완화된 기준표 · 공개 층(정답 위치 표시, 바로 옆 칩, 공개 색은 단계 구간별 한 가지 색조만 — 불가사리·단풍잎 디테일 그림은 하지 않음) · 속도 게이지(n개 더) · 최고 속도 지키기 n/14 · 진급 간주(시행 사이, 일시정지) · 목숨 없음 + 20문제 구간 · 단계 가중 점수 · 기하 도형(웹 SVG, 앱 View) · 준비 고리 + 신호 · 소개 시행 노출 L−3부터 · 공개 넘기기 · 화면 버전 재조정(−2, `quickEye.clearView`) · 데모 V2.
헤더의 장소 칩은 **«N단계» 단계 이름만**(장소 이름 없음). i18n은 위 표에서 places/journey/postcard/codex/goals/leg 관련 키를 빼고 나머지만.
오늘의 훈련 슬롯·순서는 `plan.ts`의 새 다양 구성(빠른 눈 위치 고정 안 함)을 따른다 — 위 3)·7)의 «첫 슬롯·4구간·10분»은 무시.
