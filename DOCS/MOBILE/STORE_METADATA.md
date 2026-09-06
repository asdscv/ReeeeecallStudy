# App Store / Google Play 메타데이터

> **이 문서가 스토어 등록정보의 원본이다.** 콘솔에 직접 쓰기 전에 여기를 먼저 고치고,
> 고친 내용을 App Store 8개 로케일 / Google Play 10개 로케일에 그대로 옮긴다.
>
> 마지막 반영: **2026-08-28** — 검색 유입이 0이라 리스팅 전체를 다시 썼다.
> 그날의 실측(iTunes Search API, KR 상위 200): `플래시카드`·`단어암기`·`암기`·`단어장`·
> `flashcard`·`리콜스터디`·`recall study` 전부 **미노출**, `간격반복`만 158위.
> 원인은 색인 필드 낭비였다 — 애플이 검색에 쓰는 건 **이름(30) + 부제(30) + 키워드(100)**
> 뿐인데 **부제가 8개 로케일 전부 `null`** 이었고, **이름은 8개 로케일 전부 `ReeeeecallStudy`**
> 였다. 설명문은 애플이 색인하지 않는다(Play 는 한다).
>
> 그때 함께 잡은 거짓 셋:
> ① Play `ja-JP` 짧은 설명에 한글이 섞여 있었다 — `記憶력을最大化` → `記憶力を最大化`.
> ② Play 전 로케일 긴 설명이 "Google Gemini, OpenAI, xAI/Grok, Anthropic 지원"이라고
>    적고 있었다. 지금은 서버 키 단일 구성이고 앱에 API 키 입력 UI 자체가 없다. 삭제했다.
> ③ App Store 설명이 Play 보다 한 세대 뒤처져 "5가지 학습 모드"에 인앱결제 고지가 없었다.
>
> 숫자를 여기에 박을 때는 출처 파일을 함께 적어라. 출처 없는 숫자가 다시 거짓이 된다.

## 글자수 한도 (초과하면 API 가 400 을 준다)

| 필드 | 한도 | 검색 색인 |
|---|---|---|
| App Store 이름 | 30 | ✅ 가장 무겁다 |
| App Store 부제 | 30 | ✅ |
| App Store 키워드 | 100 | ✅ (사용자에겐 안 보인다) |
| App Store 설명 | 4000 | ❌ **색인 안 됨** |
| App Store 프로모션 텍스트 | 170 | ❌ (단 심사 없이 즉시 교체 가능) |
| Google Play 앱 이름 | 30 | ✅ 가장 무겁다 |
| Google Play 짧은 설명 | 80 | ✅ |
| Google Play 긴 설명 | 4000 | ✅ 전문 검색 |

**키워드 규칙**: 애플은 이름·부제·키워드의 단어를 자동으로 조합한다. 그래서 세 필드에
같은 단어를 반복하면 그 글자수는 그냥 버려진다. 아래 목록은 이름·부제에 이미 있는 단어를
전부 뺀 상태다. 붙여쓴 질의(`recallstudy`)는 조합으로 생기지 않으므로 **토큰을 따로 넣어야
한다** — ko/ja 처럼 이름이 라틴 문자가 아닌 로케일에서는 `reeeeecallstudy` 도 함께 넣어
기존 브랜드 검색을 잃지 않게 한다.

Play 도 마찬가지다. 제목의 `Recall Study` 는 `recall` + `study` **두 토큰**으로 쪼개지므로
붙여쓴 `recallstudy` 질의는 걸리지 않는다. 그래서 긴 설명 끝에 로케일마다 한 줄
(`(Also written as Recall Study or recallstudy.)` 같은 문장)을 두어 그 토큰을 심어 둔다.
이 줄을 지우면 Play 10개 로케일에서 `recallstudy` 검색이 통째로 죽는다.

**이름/부제와 겹치는 키워드는 버려진 글자수다.** 2026-08-28 첫 작성 때 zh(`复习`,`考试`)·
vi(`ghi nhớ`)·id(`belajar`,`kartu`)·es(`repaso`)가 이름/부제에 이미 있는 말을 키워드에서
또 썼다가 잡혀 교체했다. 단순 단어 비교로는 못 잡는다 — 공백이 든 구절(`ghi nhớ`)과
CJK 부분일치(`考试복습`)까지 봐야 한다.

**경쟁 서비스 이름 금지**: 키워드에도 설명에도 다른 학습 앱 이름을 넣지 않는다. 애플 심사
거절 사유이기도 하고, 이 저장소의 규칙이기도 하다.

## 반영 방법

- **Google Play**: 빌드 없이 Android Publisher API 로 즉시 반영된다
  (`edits.insert` → `edits.listings.update` × 로케일 → `edits.commit`).
  자격증명 `packages/mobile/google-service-account.json`.
- **App Store**: 이름·부제·키워드·설명은 **버전 스코프**다. 라이브 버전에는 못 쓴다.
  `POST /v1/appStoreVersions` 로 새 버전을 만들면 편집 가능한 `appInfo` 가 함께 생긴다.
  → 이름/부제는 `appInfoLocalizations`, 키워드/설명/프로모션/새소식은
  `appStoreVersionLocalizations` 에 PATCH. 자격증명은
  `packages/mobile/AuthKey_LS8N7G3T8V.p8` (ES256 직접 서명, pyjwt 불필요).
  **빌드가 붙어야 심사 제출이 된다** — `expo.version` 을 새 버전 문자열로 올리고 빌드할 것
  (자세한 함정은 `DOCS/DEPLOYMENT/STORE_SUBMISSION.md` §2-2b).

---
## 영어 (en-US / 기본 로케일)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `ReeeeecallStudy: Flashcards` | 27/30 |
| App Store 부제 | `AI Cards & Spaced Repetition` | 28/30 |
| App Store 키워드 | `recallstudy,recall,study,memorize,vocabulary,quiz,exam,revision,srs,language,school,cram` | 88/100 |
| Play 앱 이름 | `ReeeeecallStudy: AI Flashcards` | 30/30 |
| Play 짧은 설명 | Recall Study: AI flashcards + spaced repetition (SRS) to memorize anything fast. | 80/80 |
| 프로모션 텍스트 | New: turn a photo of your notes into a full flashcard deck with AI, and let spaced repetition schedule every review for you. 10 free AI cards every day. | 152/170 |

<details><summary>긴 설명 (2173/4000) — App Store · Play 공통</summary>

```
ReeeeecallStudy (Recall Study) — the smartest way to memorize anything.

Make flashcards and let science do the rest. Our SRS (Spaced Repetition System) algorithm schedules every review for the moment you are about to forget, so you remember more with less effort. Great for vocabulary and language learning, exam prep, medical and law school, certifications, and anything else you need to keep in your head.

KEY FEATURES
• AI card generation — type a topic, or upload a photo of your notes, and get a full deck in seconds.
• SRS algorithm — scientifically proven spaced repetition. Cards come back right before you forget them.
• 6 study modes — SRS Review, Sequential Review, Random, Sequential, By Date and Cramming. Pick what fits how you study.
• AI quizzes — multiple choice, short answer and essay questions generated from your own cards and graded by AI.
• Custom templates — design card layouts with multiple fields, Text-to-Speech in any language, and your own styling.
• Detailed statistics — study streaks, mastery rate, daily progress and session history in clear charts.
• Study goals and a daily plan built from your own decks.

CONNECT & SHARE
• Marketplace — publish your decks or download high-quality decks made by the community.
• Deck sharing — share by link, with Copy, Subscribe and Snapshot modes.
• Import & export — full control over your data. JSON and CSV, in and out, anytime. Your cards, your data.

PRIVACY & LANGUAGES
• 8 languages: English, Korean, Japanese, Chinese, Vietnamese, Thai, Indonesian and Spanish.
• Syncs across web, iPhone, iPad and Android.
• Export your cards and study history to CSV or JSON at any time, and delete your account from Settings whenever you want.

PRICING
• Free — store up to 5,000 cards, plus 10 AI cards and 5 AI quiz questions every day.
• Standard ($3.99/month) — raises the card limit to 100,000.
• AI credit packs ($0.99 / $4.99 / $9.99) — for AI use beyond the daily free allowance.
• AI runs on our servers. There is no API key to buy or configure, and the app never asks you for one.

Start studying smarter today. Download ReeeeecallStudy for free.

(Also written as Recall Study or recallstudy.)
```

</details>

## 한국어 (ko / ko-KR)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `리콜스터디: AI 암기카드 단어장` | 18/30 |
| App Store 부제 | `플래시카드 영단어 암기앱 간격반복` | 18/30 |
| App Store 키워드 | `recallstudy,reeeeecallstudy,recall,study,단어암기,암기법,단어외우기,반복학습,복습,퀴즈,공부앱,자격증,토익,수능,공무원,오답노트` | 89/100 |
| Play 앱 이름 | `리콜스터디: AI 암기카드 단어장` | 18/30 |
| Play 짧은 설명 | Recall Study - AI 암기카드와 과학적 간격반복(SRS)으로 영단어·시험공부를 가장 빠르게. | 57/80 |
| 프로모션 텍스트 | 새 기능: 필기 사진 한 장이면 AI가 암기카드 한 덱을 만들어 줍니다. 복습 시점은 간격 반복이 알아서 잡습니다. 매일 AI 카드 10장 무료. | 81/170 |

<details><summary>긴 설명 (1185/4000) — App Store · Play 공통</summary>

```
리콜스터디(ReeeeecallStudy / Recall Study) — 무엇이든 가장 똑똑하게 외우는 법.

카드만 만들면 나머지는 과학이 합니다. SRS(간격 반복) 알고리즘이 잊기 직전의 순간에 복습을 배치해, 더 적은 노력으로 더 오래 기억하게 합니다. 영단어와 어학, 시험공부, 수능·공무원·자격증, 전공 암기까지 외워야 하는 모든 것에 맞습니다.

주요 기능
• AI 카드 생성 — 주제를 입력하거나 필기 사진을 올리면 몇 초 만에 덱 하나가 완성됩니다.
• SRS 알고리즘 — 과학적으로 검증된 간격 반복. 망각 직전의 카드를 다시 꺼내 장기 기억으로 넘깁니다.
• 6가지 학습 모드 — SRS 복습, 순차 복습, 랜덤, 순차 학습, 날짜별, 벼락치기 중에서 고르세요.
• AI 퀴즈 — 내 카드로 객관식·단답형·서술형 문제를 만들고 AI가 채점합니다.
• 커스텀 템플릿 — 여러 필드, 전 세계 언어 TTS(음성 합성), 원하는 스타일로 나만의 카드를 디자인하세요.
• 상세 통계 — 학습 스트릭, 마스터율, 일일 진행도, 학습 히스토리를 한눈에 보이는 차트로.
• 학습 목표와 내 덱으로 짜는 오늘의 학습 계획.

공유와 연결
• 마켓플레이스 — 내 덱을 공개하거나, 다른 사람이 만든 좋은 덱을 받아 쓰세요.
• 덱 공유 — 링크 하나로. 복사·구독·스냅샷 모드를 지원합니다.
• 가져오기/내보내기 — 데이터는 온전히 내 것입니다. JSON·CSV로 언제든 넣고 뺄 수 있습니다.

개인정보와 언어
• 8개 언어: 한국어, 영어, 일본어, 중국어, 베트남어, 태국어, 인도네시아어, 스페인어.
• 웹, iPhone, iPad, Android가 같은 계정으로 동기화됩니다.
• 카드와 학습 기록은 언제든 CSV·JSON으로 내보낼 수 있고, 계정 삭제는 설정에서 직접 할 수 있습니다.

요금
• 무료 — 카드 5,000장까지 보관, 매일 AI 카드 10장과 AI 퀴즈 5문항.
• Standard(월 $3.99) — 카드 한도를 100,000장으로 올립니다.
• AI 크레딧 팩($0.99 / $4.99 / $9.99) — 매일 주어지는 무료분을 넘겨 쓸 때.
• AI는 저희 서버에서 돌아갑니다. 따로 살 API 키도, 넣을 API 키도 없습니다.

오늘부터 더 똑똑하게 공부하세요. 리콜스터디는 무료로 시작합니다.

(리콜스터디는 Recall Study · recallstudy 로도 표기합니다.)
```

</details>

## 일본어 (ja / ja-JP)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `リコールスタディ: AI暗記カード単語帳` | 20/30 |
| App Store 부제 | `フラッシュカード・間隔反復・英単語` | 17/30 |
| App Store 키워드 | `recallstudy,reeeeecallstudy,recall,study,暗記アプリ,勉強,テスト対策,復習,クイズ,語彙,資格,受験,記憶術,SRS,問題集,語学` | 86/100 |
| Play 앱 이름 | `リコールスタディ: AI暗記カード単語帳` | 20/30 |
| Play 짧은 설명 | Recall Study - AIカード生成と科学的なSRS（間隔反復）で記憶力を最大化。 | 45/80 |
| 프로모션 텍스트 | 新機能：ノートの写真から、AIが暗記カードのデッキを丸ごと作成。復習のタイミングは間隔反復におまかせ。毎日AIカード10枚が無料です。 | 67/170 |

<details><summary>긴 설명 (1080/4000) — App Store · Play 공통</summary>

```
リコールスタディ（ReeeeecallStudy / Recall Study）— あらゆるものを暗記する、最もスマートな方法。

カードを作れば、あとは科学の仕事です。SRS（間隔反復）アルゴリズムが「忘れる直前」に復習を配置するので、少ない労力で長く覚えていられます。英単語や語学、テスト対策、資格試験、専門科目の暗記まで。

主な機能
• AIカード生成 — トピックを入力するか、ノートの写真を上げるだけで、数秒でデッキが完成します。
• SRSアルゴリズム — 科学的に実証された間隔反復。忘れる直前にカードを出し、長期記憶に送ります。
• 6つの学習モード — SRS復習、順次復習、ランダム、順次学習、日付別、一夜漬けから選べます。
• AIクイズ — 自分のカードから選択式・短答式・記述式の問題を作り、AIが採点します。
• カスタムテンプレート — 複数フィールド、多言語対応のTTS（読み上げ）、自由なスタイルで自分専用のカードを。
• 詳細な統計 — 学習ストリーク、習得率、日々の進捗、学習履歴を見やすいチャートで。
• 学習目標と、自分のデッキから組み立てる今日の学習プラン。

共有とつながり
• マーケットプレイス — 自分のデッキを公開したり、他の人が作った良質なデッキを使ったり。
• デッキ共有 — リンク一つで。コピー／購読／スナップショットの各モードに対応。
• インポート＆エクスポート — データの主権は常にあなたに。JSON・CSVでいつでも出し入れできます。

プライバシーと言語
• 8言語対応：日本語、韓国語、英語、中国語、ベトナム語、タイ語、インドネシア語、スペイン語。
• ウェブ、iPhone、iPad、Androidが同じアカウントで同期します。
• カードと学習履歴はいつでもCSV・JSONに書き出せ、アカウント削除は設定から自分で行えます。

料金
• 無料 — カード5,000枚まで保存でき、毎日AIカード10枚とAIクイズ5問が使えます。
• Standard（月額$3.99）— カード上限が100,000枚になります。
• AIクレジットパック（$0.99 / $4.99 / $9.99）— 毎日の無料分を超えて使うとき。
• AIは当社のサーバーで動きます。APIキーを買う必要も、入力する必要もありません。

今日から、もっとスマートな学習を。リコールスタディは無料で始められます。

（リコールスタディは Recall Study／recallstudy とも表記します。）
```

</details>

## 중국어 간체 (zh-Hans / zh-CN)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `Recall Study 闪卡背单词` | 18/30 |
| App Store 부제 | `AI记忆卡·间隔重复·考试复习` | 15/30 |
| App Store 키워드 | `recallstudy,reeeeecallstudy,抽认卡,单词卡,测验,词汇,学习,SRS,笔记,英语,记忆法,记单词,刷题,速记,默写,外语,自学,考研,记忆训练` | 85/100 |
| Play 앱 이름 | `Recall Study: 闪卡背单词` | 19/30 |
| Play 짧은 설명 | 用 AI 闪卡与科学的间隔重复（SRS），把任何知识牢牢记住。 | 31/80 |
| 프로모션 텍스트 | 新功能：拍一张笔记照片，AI 就能生成一整副闪卡；复习时机交给间隔重复算法。每天 10 张 AI 卡片免费。 | 54/170 |

<details><summary>긴 설명 (905/4000) — App Store · Play 공통</summary>

```
Recall Study（ReeeeecallStudy）—— 记住任何东西的最聪明方式。

做好卡片，剩下的交给科学。SRS（间隔重复）算法会把复习安排在你即将遗忘的那一刻，让你用更少的力气记得更久。适合背单词与语言学习、考试复习、资格证书，以及任何你需要长期记住的内容。

核心功能
• AI 生成卡片 —— 输入一个主题，或上传一张笔记照片，几秒钟就得到一整副卡组。
• SRS 算法 —— 经科学验证的间隔重复。在你快要忘记时把卡片重新推给你。
• 6 种学习模式 —— SRS 复习、顺序复习、随机、顺序学习、按日期、突击复习，任你选择。
• AI 测验 —— 用你自己的卡片生成选择题、简答题和论述题，并由 AI 批改。
• 自定义模板 —— 多字段、全球语言 TTS（语音朗读）、自由样式，设计属于你的卡片。
• 详细统计 —— 学习连续天数、掌握率、每日进度与学习历史，都在清晰的图表里。
• 学习目标，以及用你自己的卡组生成的每日学习计划。

分享与连接
• 卡组市场 —— 发布你的卡组，或下载社区里的优质卡组。
• 卡组分享 —— 一条链接即可，支持复制、订阅、快照三种模式。
• 导入与导出 —— 数据完全属于你。JSON 与 CSV 随时进出。

隐私与语言
• 支持 8 种语言：中文、韩语、英语、日语、越南语、泰语、印尼语、西班牙语。
• 网页版、iPhone、iPad 与 Android 使用同一账号同步。
• 卡片与学习记录随时可导出为 CSV 或 JSON，账号也可在设置中自行删除。

价格
• 免费 —— 最多保存 5,000 张卡片，每天赠送 10 张 AI 卡片和 5 道 AI 测验题。
• Standard（每月 $3.99）—— 卡片上限提升至 100,000 张。
• AI 积分包（$0.99 / $4.99 / $9.99）—— 超出每日免费额度时使用。
• AI 在我们的服务器上运行，无需购买或填写任何 API 密钥。

今天就开始更聪明地学习。Recall Study 免费下载。

（Recall Study 也写作 recallstudy。）
```

</details>

## 베트남어 (vi)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `Recall Study: Thẻ ghi nhớ AI` | 28/30 |
| App Store 부제 | `Lặp lại ngắt quãng & từ vựng` | 28/30 |
| App Store 키워드 | `recallstudy,reeeeecallstudy,ôn tập,trắc nghiệm,thẻ học,SRS,ngôn ngữ,thi cử,tiếng anh,flashcard` | 94/100 |
| Play 앱 이름 | `Recall Study: Thẻ ghi nhớ AI` | 28/30 |
| Play 짧은 설명 | Ghi nhớ nhanh hơn với thẻ ghi nhớ AI và hệ thống lặp lại ngắt quãng (SRS). | 74/80 |
| 프로모션 텍스트 | Mới: biến ảnh chụp ghi chép thành cả một bộ thẻ ghi nhớ bằng AI, và để lặp lại ngắt quãng sắp lịch ôn cho bạn. 10 thẻ AI miễn phí mỗi ngày. | 139/170 |

<details><summary>긴 설명 (1990/4000) — App Store · Play 공통</summary>

```
Recall Study (ReeeeecallStudy) — cách thông minh nhất để ghi nhớ mọi thứ.

Bạn chỉ cần tạo thẻ, phần còn lại để khoa học lo. Thuật toán SRS (lặp lại ngắt quãng) sắp lịch ôn đúng vào lúc bạn sắp quên, nên bạn nhớ lâu hơn với ít công sức hơn. Phù hợp cho từ vựng và học ngoại ngữ, ôn thi, chứng chỉ và mọi kiến thức bạn cần giữ trong đầu.

TÍNH NĂNG CHÍNH
• Tạo thẻ bằng AI — nhập một chủ đề, hoặc tải lên ảnh ghi chép, và có ngay một bộ thẻ hoàn chỉnh sau vài giây.
• Thuật toán SRS — lặp lại ngắt quãng đã được khoa học chứng minh. Thẻ quay lại ngay trước khi bạn quên.
• 6 chế độ học — Ôn SRS, Ôn tuần tự, Ngẫu nhiên, Tuần tự, Theo ngày và Nhồi nhanh.
• Trắc nghiệm AI — câu hỏi trắc nghiệm, trả lời ngắn và tự luận tạo từ chính thẻ của bạn, do AI chấm.
• Mẫu thẻ tùy chỉnh — nhiều trường dữ liệu, TTS (đọc thành tiếng) mọi ngôn ngữ, và kiểu dáng riêng của bạn.
• Thống kê chi tiết — chuỗi ngày học, tỷ lệ thành thạo, tiến độ hằng ngày và lịch sử học trên biểu đồ rõ ràng.
• Mục tiêu học tập và kế hoạch mỗi ngày dựng từ chính bộ thẻ của bạn.

KẾT NỐI & CHIA SẺ
• Chợ bộ thẻ — đăng bộ thẻ của bạn hoặc tải về bộ thẻ chất lượng cao từ cộng đồng.
• Chia sẻ bộ thẻ — bằng liên kết, với các chế độ Sao chép, Đăng ký và Ảnh chụp.
• Nhập & xuất — dữ liệu là của bạn. JSON và CSV, ra vào bất cứ lúc nào.

QUYỀN RIÊNG TƯ & NGÔN NGỮ
• 8 ngôn ngữ: Tiếng Việt, Hàn, Anh, Nhật, Trung, Thái, Indonesia và Tây Ban Nha.
• Đồng bộ giữa web, iPhone, iPad và Android.
• Xuất thẻ và lịch sử học ra CSV hoặc JSON bất cứ lúc nào, và xóa tài khoản ngay trong Cài đặt.

GIÁ
• Miễn phí — lưu tới 5.000 thẻ, cùng 10 thẻ AI và 5 câu hỏi trắc nghiệm AI mỗi ngày.
• Standard ($3,99/tháng) — nâng giới hạn thẻ lên 100.000.
• Gói tín dụng AI ($0,99 / $4,99 / $9,99) — cho phần dùng AI vượt hạn mức miễn phí hằng ngày.
• AI chạy trên máy chủ của chúng tôi. Không cần mua hay nhập bất kỳ khóa API nào.

Bắt đầu học thông minh hơn ngay hôm nay. Tải Recall Study miễn phí.

(Còn được viết là Recall Study hoặc recallstudy.)
```

</details>

## 태국어 (th)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `Recall Study: แฟลชการ์ด AI` | 26/30 |
| App Store 부제 | `ทบทวนเว้นระยะ ท่องศัพท์ SRS` | 27/30 |
| App Store 키워드 | `recallstudy,reeeeecallstudy,ท่องจำ,แบบทดสอบ,คำศัพท์,ภาษา,สอบ,เรียน,บัตรคำ,ความจำ,อ่านหนังสือ` | 92/100 |
| Play 앱 이름 | `Recall Study: แฟลชการ์ด AI` | 26/30 |
| Play 짧은 설명 | จำได้เร็วขึ้นด้วยแฟลชการ์ด AI และการทบทวนเว้นระยะ (SRS) ที่พิสูจน์แล้ว | 70/80 |
| 프로모션 텍스트 | ใหม่: เปลี่ยนรูปสมุดจดให้เป็นชุดแฟลชการ์ดทั้งชุดด้วย AI และให้ระบบทบทวนเว้นระยะจัดตารางให้คุณ ฟรีวันละ 10 การ์ด AI | 114/170 |

<details><summary>긴 설명 (1834/4000) — App Store · Play 공통</summary>

```
Recall Study (ReeeeecallStudy) — วิธีที่ฉลาดที่สุดในการจดจำทุกสิ่ง

แค่สร้างการ์ด ที่เหลือปล่อยให้วิทยาศาสตร์จัดการ อัลกอริทึม SRS (การทบทวนแบบเว้นระยะ) จะจัดตารางทบทวนในจังหวะที่คุณกำลังจะลืมพอดี คุณจึงจำได้มากขึ้นโดยใช้แรงน้อยลง เหมาะกับการท่องศัพท์และเรียนภาษา เตรียมสอบ สอบใบประกอบวิชาชีพ และทุกอย่างที่คุณต้องจำ

ฟีเจอร์หลัก
• สร้างการ์ดด้วย AI — พิมพ์หัวข้อ หรืออัปโหลดรูปสมุดจดของคุณ แล้วได้ชุดการ์ดเต็มชุดในไม่กี่วินาที
• อัลกอริทึม SRS — การทบทวนแบบเว้นระยะที่พิสูจน์แล้วทางวิทยาศาสตร์ การ์ดจะกลับมาก่อนที่คุณจะลืม
• 6 โหมดการเรียน — ทบทวนแบบ SRS, ทบทวนตามลำดับ, สุ่ม, ตามลำดับ, ตามวันที่ และอ่านรวบยอด
• แบบทดสอบ AI — ข้อสอบปรนัย อัตนัยสั้น และเรียงความ สร้างจากการ์ดของคุณเองและตรวจโดย AI
• เทมเพลตที่ปรับแต่งได้ — หลายฟิลด์ TTS (อ่านออกเสียง) ทุกภาษา และสไตล์ที่คุณออกแบบเอง
• สถิติละเอียด — สถิติต่อเนื่อง อัตราความเชี่ยวชาญ ความคืบหน้ารายวัน และประวัติการเรียนในกราฟที่อ่านง่าย
• เป้าหมายการเรียน และแผนประจำวันที่สร้างจากชุดการ์ดของคุณเอง

เชื่อมต่อและแบ่งปัน
• มาร์เก็ตเพลส — เผยแพร่ชุดการ์ดของคุณ หรือดาวน์โหลดชุดการ์ดคุณภาพดีจากคนอื่น
• แชร์ชุดการ์ด — ด้วยลิงก์เดียว รองรับโหมดคัดลอก ติดตาม และสแนปช็อต
• นำเข้าและส่งออก — ข้อมูลเป็นของคุณเต็มที่ ทั้ง JSON และ CSV เข้าออกได้ตลอดเวลา

ความเป็นส่วนตัวและภาษา
• รองรับ 8 ภาษา: ไทย เกาหลี อังกฤษ ญี่ปุ่น จีน เวียดนาม อินโดนีเซีย และสเปน
• ซิงก์ระหว่างเว็บ iPhone iPad และ Android
• ส่งออกการ์ดและประวัติการเรียนเป็น CSV หรือ JSON ได้ตลอดเวลา และลบบัญชีได้เองในหน้าตั้งค่า

ราคา
• ฟรี — เก็บการ์ดได้ถึง 5,000 ใบ พร้อมการ์ด AI 10 ใบ และคำถาม AI 5 ข้อทุกวัน
• Standard ($3.99/เดือน) — เพิ่มขีดจำกัดการ์ดเป็น 100,000 ใบ
• แพ็กเครดิต AI ($0.99 / $4.99 / $9.99) — สำหรับการใช้ AI เกินโควตาฟรีรายวัน
• AI ทำงานบนเซิร์ฟเวอร์ของเรา ไม่ต้องซื้อหรือกรอก API key ใด ๆ

เริ่มเรียนให้ฉลาดขึ้นตั้งแต่วันนี้ ดาวน์โหลด Recall Study ฟรี

(เขียนได้อีกแบบว่า Recall Study หรือ recallstudy)
```

</details>

## 인도네시아어 (id)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `Recall Study: Kartu Belajar AI` | 30/30 |
| App Store 부제 | `Pengulangan Berjarak, Kosakata` | 30/30 |
| App Store 키워드 | `recallstudy,reeeeecallstudy,hafalan,menghafal,kuis,ujian,bahasa,flashcard,SRS,ingatan,inggris,tes` | 97/100 |
| Play 앱 이름 | `Recall Study: Kartu Belajar AI` | 30/30 |
| Play 짧은 설명 | Hafal lebih cepat dengan flashcard AI dan sistem pengulangan berjarak (SRS). | 76/80 |
| 프로모션 텍스트 | Baru: ubah foto catatan Anda menjadi satu dek flashcard penuh dengan AI, dan biarkan pengulangan berjarak menjadwalkan ulasannya. 10 kartu AI gratis tiap hari. | 159/170 |

<details><summary>긴 설명 (2134/4000) — App Store · Play 공통</summary>

```
Recall Study (ReeeeecallStudy) — cara paling cerdas untuk menghafal apa pun.

Anda cukup membuat kartu, sisanya biar sains yang bekerja. Algoritme SRS (pengulangan berjarak) menjadwalkan ulasan tepat saat Anda hampir lupa, sehingga Anda ingat lebih lama dengan usaha lebih kecil. Cocok untuk kosakata dan belajar bahasa, persiapan ujian, sertifikasi, dan apa pun yang perlu Anda ingat.

FITUR UTAMA
• Pembuatan kartu dengan AI — ketik satu topik, atau unggah foto catatan Anda, dan dapatkan satu dek penuh dalam hitungan detik.
• Algoritme SRS — pengulangan berjarak yang terbukti secara ilmiah. Kartu kembali tepat sebelum Anda melupakannya.
• 6 mode belajar — Ulasan SRS, Ulasan Berurutan, Acak, Berurutan, Menurut Tanggal, dan Kebut Semalam.
• Kuis AI — soal pilihan ganda, isian singkat, dan esai yang dibuat dari kartu Anda sendiri dan dinilai oleh AI.
• Templat khusus — banyak kolom, TTS (teks ke suara) dalam berbagai bahasa, dan gaya rancangan Anda sendiri.
• Statistik terperinci — rentetan belajar, tingkat penguasaan, kemajuan harian, dan riwayat sesi dalam grafik yang jelas.
• Sasaran belajar dan rencana harian yang disusun dari dek Anda sendiri.

TERHUBUNG & BERBAGI
• Marketplace — terbitkan dek Anda atau unduh dek berkualitas dari komunitas.
• Berbagi dek — lewat tautan, dengan mode Salin, Berlangganan, dan Snapshot.
• Impor & ekspor — data sepenuhnya milik Anda. JSON dan CSV, keluar masuk kapan saja.

PRIVASI & BAHASA
• 8 bahasa: Indonesia, Korea, Inggris, Jepang, Mandarin, Vietnam, Thai, dan Spanyol.
• Tersinkron di web, iPhone, iPad, dan Android.
• Ekspor kartu dan riwayat belajar ke CSV atau JSON kapan saja, dan hapus akun langsung dari Pengaturan.

HARGA
• Gratis — simpan hingga 5.000 kartu, plus 10 kartu AI dan 5 soal kuis AI setiap hari.
• Standard ($3,99/bulan) — menaikkan batas kartu menjadi 100.000.
• Paket kredit AI ($0,99 / $4,99 / $9,99) — untuk pemakaian AI di luar jatah gratis harian.
• AI berjalan di server kami. Tidak ada API key yang perlu dibeli atau dimasukkan.

Mulai belajar lebih cerdas hari ini. Unduh Recall Study gratis.

(Juga ditulis sebagai Recall Study atau recallstudy.)
```

</details>

## 스페인어 (es-ES / es-419 / es-US)

| 필드 | 값 | 길이 |
|---|---|---|
| App Store 이름 | `Recall Study: Tarjetas con IA` | 29/30 |
| App Store 부제 | `Repetición espaciada y repaso` | 29/30 |
| App Store 키워드 | `recallstudy,reeeeecallstudy,memorizar,vocabulario,examen,estudio,quiz,idiomas,fichas,SRS,oposiciones` | 100/100 |
| Play 앱 이름 | `Recall Study: Tarjetas con IA` | 29/30 |
| Play 짧은 설명 | Memoriza más rápido con tarjetas de IA y repetición espaciada (SRS) científica. | 79/80 |
| 프로모션 텍스트 | Nuevo: convierte una foto de tus apuntes en un mazo completo con IA y deja que la repetición espaciada programe cada repaso. 10 tarjetas de IA gratis al día. | 157/170 |

<details><summary>긴 설명 (2301/4000) — App Store · Play 공통</summary>

```
Recall Study (ReeeeecallStudy): la forma más inteligente de memorizar cualquier cosa.

Tú creas las tarjetas y la ciencia hace el resto. Nuestro algoritmo SRS (repetición espaciada) programa cada repaso justo en el momento en que estás a punto de olvidar, así recuerdas más con menos esfuerzo. Ideal para vocabulario e idiomas, preparación de exámenes, oposiciones, certificaciones y todo lo que necesites retener.

FUNCIONES PRINCIPALES
• Generación de tarjetas con IA: escribe un tema, o sube una foto de tus apuntes, y obtén un mazo completo en segundos.
• Algoritmo SRS: repetición espaciada probada científicamente. Las tarjetas vuelven justo antes de que las olvides.
• 6 modos de estudio: repaso SRS, repaso secuencial, aleatorio, secuencial, por fecha y empollar.
• Cuestionarios con IA: preguntas tipo test, de respuesta corta y de desarrollo creadas a partir de tus propias tarjetas y corregidas por IA.
• Plantillas personalizadas: múltiples campos, TTS (texto a voz) en cualquier idioma y tu propio estilo.
• Estadísticas detalladas: rachas de estudio, tasa de dominio, progreso diario e historial de sesiones en gráficos claros.
• Objetivos de estudio y un plan diario creado a partir de tus propios mazos.

CONECTA Y COMPARTE
• Marketplace: publica tus mazos o descarga mazos de calidad creados por la comunidad.
• Compartir mazos: por enlace, con los modos Copiar, Suscribirse e Instantánea.
• Importar y exportar: control total de tus datos. JSON y CSV, de entrada y de salida, cuando quieras.

PRIVACIDAD E IDIOMAS
• 8 idiomas: español, coreano, inglés, japonés, chino, vietnamita, tailandés e indonesio.
• Se sincroniza entre la web, iPhone, iPad y Android.
• Exporta tus tarjetas y tu historial de estudio a CSV o JSON en cualquier momento, y elimina tu cuenta desde Ajustes.

PRECIOS
• Gratis: guarda hasta 5.000 tarjetas, más 10 tarjetas de IA y 5 preguntas de IA cada día.
• Standard (3,99 $/mes): eleva el límite de tarjetas a 100.000.
• Packs de créditos de IA (0,99 $ / 4,99 $ / 9,99 $): para el uso de IA que supere la cuota gratuita diaria.
• La IA se ejecuta en nuestros servidores. No hay ninguna clave de API que comprar ni que introducir.

Empieza hoy a estudiar de forma más inteligente. Descarga Recall Study gratis.

(También escrito como Recall Study o recallstudy.)
```

</details>
---

## 설명문에 박힌 숫자의 출처

| 주장 | 출처 |
|---|---|
| 학습 모드 6가지 | `packages/shared/lib/study-validation.ts` → `STUDY_MODES` |
| 8개 언어 | `packages/web/src/lib/locale-utils.ts` → `SUPPORTED_LOCALES` |
| 무료 카드 5,000장 | 마이그레이션 268 → `card_limit_settings.max_owned_cards = 5000` |
| Standard 100,000장 | 마이그레이션 268 → `billing_products.card_limit = 100000` (`sub_5k_monthly`) |
| Standard 월 $3.99 | 마이그레이션 129 → `price_usd_cents = 399` |
| AI 크레딧 팩 $0.99 / $4.99 / $9.99 | 마이그레이션 128 → `credits_1000` / `credits_5000` / `credits_10000` |
| 매일 무료 AI 카드 10장 · AI 퀴즈 5문항 | AI 무료 티어 (마이그레이션 108–115) |
| API 키 불필요 | 서버 측 생성. 앱에 키 입력 UI 자체가 없다 |

> **"무제한"은 어떤 형태로도 쓰지 않는다.** Pro 플랜의 `card_limit` 이 20억이어도 마찬가지다.
> 사용자 대면 문구에서 무제한을 약속하지 않는 것이 이 저장소의 규칙이다.

## 카테고리 / 등급

- App Store: Education · 4+
- Google Play: Education > Study Aid · Everyone (IARC)

## URL

| 항목 | 값 |
|---|---|
| 개인정보처리방침 | https://reeeeecallstudy.asdscv.workers.dev/privacy-policy.html |
| 서비스 이용약관 | https://reeeeecallstudy.asdscv.workers.dev/terms-of-service.html |
| 지원 | mailto:luke@rictax.kr |

## 스크린샷 / 이미지 — 2026-08-28 전량 교체

그 전까지 양쪽 스토어에 올라가 있던 것은 **가공하지 않은 기기 원본**이었다. Play 의 8장은
갤럭시 A31 스크린샷 그대로여서 통신사 `U+`, 시계, **카카오톡 알림 아이콘**, 안드로이드
네비게이션 바가 노출돼 있었고, App Store 의 iPhone·iPad 18장은 파일명이
`KakaoTalk_Photo_2026-04-20-….jpeg` 였다. 캡션은 양쪽 다 0개였고, 이미지가 있는 로케일도
`en-US` 하나뿐이라 나머지는 전부 폴백이었다.

지금은 **8개 언어 × 6화면**을 에뮬레이터에서 다시 찍어 캡션을 얹었다.

| 화면 | 내용 |
|---|---|
| 1 대시보드 | 카드 수·오늘 복습·스트릭·숙련도 + 카드 저장공간 |
| 2 내 덱 | 로케일 원어 덱 5종, 덱별 새/복습 배지 |
| 3 학습 모드 | 6가지 모드 시트 (SRS·순차 복습·랜덤·순차·날짜별·벼락치기) |
| 4 학습 카드 | 카드 앞면 + 4단계 평가 버튼 |
| 5 AI 자동 생성 | 5단계 마법사, 주제/이미지 모드 |
| 6 마켓플레이스 | 공식 덱 목록 |

반영 현황:

| 스토어 | 규격 | 로케일 | 수량 |
|---|---|---|---|
| Google Play 폰 | 1242×2688 | 10 (en-US·ko-KR·ja-JP·zh-CN·vi·th·id·es-ES·es-419·es-US) | 60 |
| Google Play 피처 그래픽 | 1024×500 | 10 | 10 |
| ~~App Store iPhone 6.5"~~ | ~~1242×2688~~ | 삭제됨 (2026-09-02, 아래 참조) | 0 |
| **App Store iPhone 6.7"** | **1290×2796** | 8 (en-US·ko·ja·zh-Hans·vi·th·id·es-ES) | **48** |
| **App Store iPad 13"** | **2064×2752** | en-US (나머지는 기본 로케일 폴백) | **6** |

### 다시 만들 때 (스크립트는 `~/Desktop/reeeeecall-store-images/_scripts/`)

1. `seed.py <locale>` — 데모 계정 `demo+store@rictax.kr` 에 그 로케일의 **원어 마켓 덱 5종**을
   복사하고 75일치 학습 이력을 만든다. `en` 은 마켓에 원어 덱이 없으므로(전부 "영어 학습용")
   `seed_en.py` 로 별도 영어 덱을 만든다.
2. `capture.py <locale>` — 에뮬레이터를 **1242×2688 / density 480** 으로 맞추고
   (= iPhone 6.5" 의 414×896pt) 앱 안에서 언어를 바꾼 뒤 6화면을 찍는다.
3. `compose.py` — 다크 캔버스 + 헤드라인/서브라인 + 라운드 기기 화면으로 합성.
4. `upload_play.py` / `upload_asc.py` — 두 스토어에 올린다.

### 이 과정에서 밟은 지뢰

- **상태바**: `adb shell am broadcast -a com.android.systemui.demo` 로 데모 모드를 켜
  9:41 · 알림 없음 · 배터리 100% 로 고정한다. 안 하면 통신사·알림이 그대로 찍힌다.
- **드로어 상태를 뷰 트리로 추정하면 안 된다.** 드로어 뒤의 대시보드에도 같은 y 대역에
  노드가 있어 "Study 가 펼쳐졌는지" 판정이 항상 참이 된다. 화면 전환마다 앱을 재시작해
  (드로어 닫힘 + Study 접힘) 결정적으로 만든다.
- **언어 선택 모달은 8번째 항목(Español)이 스크롤 아래**에 있다. 모달 **바깥**(y≈2100)을
  스와이프하면 아무 것도 안 움직이고 직전 로케일이 그대로 찍힌다 — 실제로 `es` 가 한 번
  인도네시아어로 찍혔다. 모달 **안쪽**(y 1700→1250)을 스와이프할 것.
- **폰트 페이스를 인덱스 탐색으로 고르면 안 된다.** 라틴은 Helvetica Neue **Italic**(index 2)이,
  태국어는 **Watch** 컷이 잡힌다. 그리고 `.ThonburiUI` 에는 **라틴 글리프가 아예 없어**
  `SRS`/`AI`/숫자가 전부 두부(▯)로 나온다 → `Supplemental/Thonburi.ttc` 를 쓴다.
- **에뮬레이터가 장시간 돌면 죽는다.** 죽은 뒤에도 `screencap` 은 **0바이트 PNG** 를 남기므로
  파일 개수만 세면 성공으로 보인다. 반드시 `Image.open().load()` 로 검증할 것 (태국어 6장이
  이렇게 통째로 비어 있었다).


### 2026-09-02 — App Store 이미지는 **실제 iOS 시뮬레이터**로 다시 찍었다

App Store 에 올라가 있던 48장은 안드로이드 에뮬레이터를 아이폰 크기로 맞춰 찍은 것이었다.
머티리얼 컴포넌트와 안드로이드 폰트가 그대로 보이는 iOS 스토어 이미지였다는 뜻이다.
지금은 **iPhone 15 Pro Max 시뮬레이터(1290×2796)** 에서 Appium 으로 직접 찍는다.

```
_scripts/iosdrive.py     raw W3C 드라이버 (webdriverio 는 node 26 에서 죽는다)
_scripts/capture_ios.py  로케일 1개 = 6화면. 전부 testID 앵커
_scripts/run_all.py      seed → 언어 전환 → 캡처 → PNG 디코딩·유일성 검증
_scripts/compose_ios.py  캡션 합성 (1290×2796)
_scripts/asc.py          ASC REST (openssl 로 ES256 직접 서명 — pyjwt 없음)
_scripts/upload_asc_ios.py  APP_IPHONE_67 세트에 업로드, --drop-65 로 옛 세트 삭제
```

- 서버는 `APPIUM_HOME=$HOME/.appium appium --port 4723 --base-path /` 로 띄운다.
- **1290×2796 은 6.5" 슬롯이 받지 않는다.** `APP_IPHONE_67`(6.7"/6.9") 에 올리고
  안드로이드로 찍었던 6.5" 세트는 지웠다 — 작은 기기는 6.7" 를 축소해서 쓴다.
- **언어 모달의 7·8번째 행(id·es)은 리스트 뷰포트 밖에 있는데 트리는 `visible=true` 로 답한다.**
  (행 y 633~686, FlatList 는 321~655) 그 좌표를 누르면 오버레이에 맞아 모달만 닫히고
  **직전 로케일 그대로 찍힌다** — 8월 안드로이드 런에서 es 가 인도네시아어로 나갔던 것과 같은 함정이다.
  `mobile: scroll` 은 더 나쁘다: 엉뚱한 컨테이너를 굴려 **한국어를 골라 버렸다**.
  리스트 박스를 찾아 그 **안쪽만** 스와이프하고, 전환 여부는 드롭다운 라벨로 **검증**한다.
- 카드 `field_values` 에 템플릿에 없는 키(`kind` 등)를 넣으면 **학습 화면이 본문을 렌더하지 않는다.**
  `seed_en.py` 가 그랬고, 4번 화면이 빈 카드로 찍혔다.
- 6.5" 세트를 지웠어도 원본은 `phone/<loc>/` 에 그대로 있다.
- **iPad 13" 세트는 이때 안 고쳤다.** 아래 참조 — 그대로 뒀으면 같은 사유로 다시 리젝됐다.

### 2026-09-06 — iPad 13" 6장도 실제 iPad 시뮬레이터로 교체 (5.6 리젝의 나머지 절반)

9/2 에 iPhone 48장만 갈고 **iPad 13" 6장(en-US)은 안드로이드 캡처 그대로 남겨 뒀었다.**
en-US 는 모든 로케일의 폴백이라 아이패드 제품 페이지 전체가 그 이미지였다. 리젝 사유가
스크린샷이었으므로 그 상태의 재제출은 같은 5.6 을 다시 받는 길이었다.

```
_scripts/drv.py          raw W3C 드라이버 (webdriverio 는 최신 node 에서 죽는다)
_scripts/capture_ipad.py iPad Pro 13" (M4) iOS 17.5, 6화면, 전부 testID 앵커
_scripts/compose.py      캡션 합성 (make(..., size=(2064,2752), fit=...))
_scripts/upload_ipad.py  APP_IPAD_PRO_3GEN_129 세트 교체
_scripts/seed_en.py + history.py + fix_states.py   데모 계정 영어 덱 + SRS 이력
```

- **시뮬레이터 언어는 부팅 전에 plist 로 박는다.** `simctl spawn ... defaults write` 는
  꺼진 기기에 못 쓰고(`Bad or unknown session`) 켜진 기기에 쓰면 재부팅 전엔 안 먹는다.
  `Devices/<UDID>/data/Library/Preferences/.GlobalPreferences.plist` 의 `AppleLanguages` 를
  직접 고치고 부팅할 것.
- **드로어는 한 번에 한 섹션만 펼쳐진다.** `drawer-study-group` → `drawer-<x>-section-toggle`
  순서로 매번 다시 펼치고 자식 testID 로 검증한다(다른 토글을 누르면 앞 섹션이 접힌다).
- **덱 목록의 `Study` 버튼은 모드 시트를 열지 않는다.** Study Setup 으로만 이동하므로
  거기서 `study-deck-<id>` 타일을 한 번 더 눌러야 모드 시트가 뜬다.
- **4번 화면은 카드를 뒤집어야 한다.** 캡션이 Again/Hard/Good/Easy 를 말하는데 평가 버튼은
  `study-card-tap` 이후에만 나온다. 그리고 iPad 는 화면이 길어 하단 크롭이면 그 버튼이
  잘려나간다 → 그 장만 `fit=True`(축소 배치).
- **숙달률은 `srs_status='review' AND interval_days >= 21`**(`shared/lib/stats.ts`). 시드가
  interval 을 21 미만으로 깔면 대시보드가 2% 로 찍힌다. iPhone 세트와 같은 58% 를 맞추려면
  review 카드의 interval 을 21 이상으로 줘야 한다.
- 촬영 계정은 **마지막에 찍은 로케일의 덱이 그대로 남아 있다.** en-US 를 찍기 전에
  `seed_en.py` 를 다시 돌리지 않으면 영어 리스팅에 스페인어 덱이 찍힌다.

## 테스트 계정 (심사용)

- Email: luke@rictax.kr
- Password: (심사 제출 시 입력)

## Google Play 데이터 안전 양식 답변

| 질문 | 답변 |
|------|------|
| 데이터 수집 여부 | Yes |
| 데이터 공유 여부 | No (제3자에게 판매/공유 안 함) |
| 수집 데이터 유형 | Email, Name, App activity, App info |
| 데이터 암호화 여부 | Yes (TLS in transit, encrypted at rest) |
| 사용자 삭제 요청 가능 여부 | Yes (Settings > Delete Account) |
| 어린이 대상 여부 | No |
