import { SUPPORTED_LOCALES, type SupportedLocale } from '../../lib/locale-utils'

export type Lang = SupportedLocale
export type Localized = Record<Lang, string>

export interface Review {
  rating: number
  quote: Localized
  author: Localized
  role: Localized
  color: string
}

// --- Name pools (masked) — keyed by locale for auto-derivation ---
const NAME_POOLS: Record<Lang, string[]> = {
  ko: [
    '김**','이**','박**','최**','정**','강**','조**','윤**','장**','임**',
    '한**','오**','서**','신**','권**','황**','안**','송**','류**','홍**',
    '전**','고**','문**','양**','배**','백**','허**','남**','심**','노**',
  ],
  en: [
    'Alex R.','Sarah M.','James T.','Emily C.','Michael B.','Jessica L.','David W.','Rachel K.','Chris H.','Amanda P.',
    'Brian N.','Katie S.','Daniel F.','Olivia G.','Jason D.','Megan V.','Kevin J.','Laura Z.','Ryan O.','Nicole E.',
    'Andrew Q.','Sam I.','Tyler U.','Sophia A.','Nathan Y.','Emma W.','Justin H.','Chloe R.','Brandon M.','Lily T.',
    'Derek C.','Hannah B.','Marcus L.','Ava K.','Steven P.','Ella N.','Patrick S.','Zoey F.','Kyle G.','Grace D.',
    'Sean V.','Aria J.','Trevor Z.','Maya O.','Logan E.','Isla Q.','Dylan I.','Hailey U.','Aaron A.','Mia Y.',
  ],
  ja: [
    '田中**','佐藤**','鈴木**','高橋**','伊藤**','渡辺**','山本**','中村**','小林**','加藤**',
    '吉田**','山田**','松本**','井上**','木村**','林**','斎藤**','清水**','山口**','池田**',
    '橋本**','阿部**','石川**','前田**','藤田**','岡田**','後藤**','長谷川**','石井**','村上**',
  ],
  zh: [
    '王**','李**','张**','刘**','陈**','杨**','赵**','黄**','周**','吴**',
    '徐**','孙**','胡**','朱**','高**','林**','何**','郭**','马**','罗**',
    '梁**','宋**','郑**','谢**','韩**','唐**','冯**','于**','董**','程**',
  ],
  es: [
    'Carlos R.','María L.','Juan P.','Ana G.','Pedro M.','Laura S.','Diego T.','Sofía V.','Miguel A.','Carmen H.',
    'Javier F.','Isabel N.','Andrés C.','Lucía B.','Roberto D.','Elena K.','Fernando J.','Paula Z.','Alejandro O.','Marta E.',
    'Raúl Q.','Valentina I.','Sergio U.','Daniela W.','Martín Y.','Camila X.','Pablo R.','Gabriela M.','Tomás L.','Natalia P.',
  ],
  vi: [
    'Nguyễn V.','Trần T.','Lê H.','Phạm M.','Hoàng A.','Vũ D.','Võ K.','Đặng L.','Bùi N.','Đỗ P.',
    'Hồ Q.','Ngô R.','Dương S.','Lý U.','Trương W.','Phan X.','Mai Y.','Tô Z.','Lương B.','Đinh C.',
  ],
  th: [
    'สมชาย ก.','สมหญิง ข.','ณัฐ ค.','พิม ง.','ธน จ.','แก้ว ฉ.','ปิยะ ช.','นิด ซ.','ต้น ฌ.','ฟ้า ญ.',
    'มิน ฎ.','เก่ง ฏ.','โอ๊ค ฐ.','แนน ฑ.','บิ๊ก ฒ.','เบล ณ.','กิ๊ฟ ด.','เมย์ ต.','บอส ถ.','ออม ท.',
  ],
  id: [
    'Budi S.','Siti A.','Andi R.','Dewi P.','Agus M.','Rina L.','Hendra K.','Maya W.','Dian T.','Rizki H.',
    'Putri N.','Fajar D.','Indra G.','Novi B.','Yusuf C.','Lina F.','Bayu J.','Ratna E.','Eko Q.','Wati V.',
  ],
}

// --- Roles ---
const R: Localized[] = [
  /* 0 */ { en: 'Language Learner', ko: '어학 학습자', ja: '語学学習者', zh: '语言学习者', es: 'Estudiante de idiomas' },
  /* 1 */ { en: 'Medical Student', ko: '의대생', ja: '医学生', zh: '医学生', es: 'Estudiante de medicina' },
  /* 2 */ { en: 'University Student', ko: '대학생', ja: '大学生', zh: '大学生', es: 'Universitario' },
  /* 3 */ { en: 'Graduate Student', ko: '대학원생', ja: '大学院生', zh: '研究生', es: 'Estudiante de posgrado' },
  /* 4 */ { en: 'High School Student', ko: '고등학생', ja: '高校生', zh: '高中生', es: 'Estudiante de secundaria' },
  /* 5 */ { en: 'Working Professional', ko: '직장인', ja: '社会人', zh: '职场人', es: 'Profesional' },
  /* 6 */ { en: 'Teacher', ko: '교사', ja: '教師', zh: '教师', es: 'Profesor' },
  /* 7 */ { en: 'Exam Candidate', ko: '수험생', ja: '受験生', zh: '考生', es: 'Candidato a examen' },
  /* 8 */ { en: 'Self-learner', ko: '독학자', ja: '独学者', zh: '自学者', es: 'Autodidacta' },
  /* 9 */ { en: 'Nursing Student', ko: '간호학생', ja: '看護学生', zh: '护理学生', es: 'Estudiante de enfermería' },
  /*10 */ { en: 'Engineer', ko: '엔지니어', ja: 'エンジニア', zh: '工程师', es: 'Ingeniero' },
  /*11 */ { en: 'Developer', ko: '개발자', ja: '開発者', zh: '开发者', es: 'Desarrollador' },
  /*12 */ { en: 'Pharmacy Student', ko: '약대생', ja: '薬学生', zh: '药学生', es: 'Estudiante de farmacia' },
  /*13 */ { en: 'Law Student', ko: '법학생', ja: '法学生', zh: '法学生', es: 'Estudiante de derecho' },
  /*14 */ { en: 'Accountant', ko: '회계사', ja: '会計士', zh: '会计师', es: 'Contador' },
]

const COLORS = [
  'from-blue-500 to-cyan-400',
  'from-violet-500 to-purple-400',
  'from-emerald-500 to-teal-400',
  'from-orange-500 to-amber-400',
  'from-pink-500 to-rose-400',
  'from-indigo-500 to-blue-400',
  'from-red-500 to-orange-400',
  'from-cyan-500 to-sky-400',
  'from-fuchsia-500 to-pink-400',
  'from-lime-500 to-green-400',
]

// [rating, en, ko, ja, zh, es, roleIdx]
type D = [number, string, string, string, string, string, number]

const DATA: D[] = [
  // ── Language Learning (0-14) ──
  [5,'Passed JLPT N2 in 6 months. The SRS timing is perfect.','6개월 만에 JLPT N2 합격했어요. SRS 타이밍이 완벽해요.','6ヶ月でJLPT N2に合格。SRSのタイミングが完璧です。','6个月通过了JLPT N2，SRS时间安排太完美了。','Aprobé el JLPT N2 en 6 meses. El ritmo del SRS es perfecto.',0],
  [5,'Kanji memorization became so much easier with spaced repetition.','간격 반복 덕분에 한자 암기가 정말 쉬워졌어요.','間隔反復のおかげで漢字の暗記がとても楽になりました。','间隔重复让汉字记忆变得轻松多了。','Memorizar kanji se volvió mucho más fácil con la repetición espaciada.',0],
  [5,'TOPIK 6급 achieved! This app was my secret weapon.','TOPIK 6급 달성! 이 앱이 비밀 무기였어요.','TOPIK 6級達成！このアプリが秘密兵器でした。','考过了TOPIK 6级！这个应用是我的秘密武器。','¡Logré TOPIK nivel 6! Esta app fue mi arma secreta.',0],
  [4,'HSK 5 prep was a breeze. Love the daily review reminders.','HSK 5급 준비가 수월했어요. 매일 복습 알림이 좋아요.','HSK5級の準備が楽でした。毎日の復習リマインダーが最高。','HSK5级备考很轻松，喜欢每日复习提醒。','Preparar el HSK 5 fue muy fácil. Me encantan los recordatorios diarios.',0],
  [5,'Spanish vocabulary retention went from 30% to 85% in two months.','스페인어 어휘 기억률이 2개월 만에 30%에서 85%로 올랐어요.','2ヶ月でスペイン語の語彙定着率が30%から85%に上昇。','两个月内西班牙语词汇记忆率从30%提升到85%。','La retención de vocabulario pasó del 30% al 85% en dos meses.',0],
  [5,'French conjugations finally stick. Merci, ReeeeecallStudy!','프랑스어 동사 변화가 드디어 기억에 남아요!','フランス語の活用がやっと定着。ありがとうReeeeecallStudy！','法语动词变位终于记住了，感谢ReeeeecallStudy！','Las conjugaciones del francés por fin se quedan. ¡Merci, ReeeeecallStudy!',0],
  [4,'German cases used to confuse me. Now I get them right 90% of the time.','독일어 격변화가 헷갈렸는데 이제 90% 정확해요.','ドイツ語の格変化が混乱していたけど、今は90%正確です。','德语格变化以前总搞混，现在正确率90%。','Los casos en alemán me confundían. Ahora acierto el 90% de las veces.',5],
  [5,'Studied 2,000 Italian words in 3 months. Never thought that was possible.','3개월에 이탈리아어 2,000단어 학습. 가능할 줄 몰랐어요.','3ヶ月でイタリア語2000語を学習。可能だとは思わなかった。','3个月学了2000个意大利语单词，没想到能做到。','Estudié 2.000 palabras en italiano en 3 meses. Nunca pensé que fuera posible.',8],
  [5,'My TOEFL score jumped 15 points after using this for vocabulary.','어휘 학습에 사용한 후 토플 점수가 15점 올랐어요.','語彙学習に使った後、TOEFLスコアが15点アップ。','用来背单词后托福成绩提高了15分。','Mi puntaje TOEFL subió 15 puntos después de usar esto para vocabulario.',7],
  [4,'IELTS band 7.5 thanks to systematic vocabulary building here.','체계적인 어휘 학습으로 IELTS 7.5 달성했어요.','体系的な語彙学習でIELTS 7.5を達成。','通过系统化的词汇学习拿到了雅思7.5分。','IELTS banda 7.5 gracias al aprendizaje sistemático de vocabulario.',7],
  [5,'GRE vocab prep was painless. Learned 800 words in a month.','GRE 어휘 준비가 수월했어요. 한 달에 800단어 학습.','GRE語彙対策が楽でした。1ヶ月で800語習得。','GRE词汇准备很轻松，一个月学了800个单词。','Preparar vocabulario GRE fue indoloro. Aprendí 800 palabras en un mes.',3],
  [5,'Business English idioms are finally in my long-term memory.','비즈니스 영어 관용구가 드디어 장기 기억에 남아요.','ビジネス英語のイディオムがやっと長期記憶に定着。','商务英语习语终于进入了长期记忆。','Los modismos de inglés de negocios por fin están en mi memoria a largo plazo.',5],
  [4,'The TTS feature helps my pronunciation so much. Game changer.','TTS 기능 덕분에 발음이 많이 좋아졌어요. 혁명적이에요.','TTS機能のおかげで発音がすごく上達。革命的です。','TTS功能大大帮助了我的发音，太棒了。','La función TTS ayuda mucho con mi pronunciación. Un cambio total.',0],
  [5,'Went from zero to conversational Korean in 4 months.','4개월 만에 한국어 제로에서 일상 회화 수준으로.','4ヶ月で韓国語ゼロから日常会話レベルに。','4个月从零基础到能用韩语日常对话。','De cero a coreano conversacional en 4 meses.',8],
  [5,'Mandarin tones are tricky but the SRS helped me master them.','중국어 성조가 어렵지만 SRS로 완벽히 익혔어요.','中国語の声調は難しいけどSRSで完璧にマスター。','中文声调很难但SRS帮我完全掌握了。','Los tonos del mandarín son difíciles pero el SRS me ayudó a dominarlos.',0],
  // ── Medical / Nursing / Pharmacy (15-24) ──
  [5,'Anatomy terms that took weeks to learn now stick in days.','몇 주 걸리던 해부학 용어를 며칠이면 외워요.','何週間もかかった解剖学用語が数日で定着するように。','以前要几周才能记住的解剖学术语现在几天就行。','Términos de anatomía que tomaban semanas ahora se fijan en días.',1],
  [5,'Pharmacology review before exams is 10x more efficient now.','시험 전 약리학 복습이 10배는 효율적이에요.','試験前の薬理学の復習が10倍効率的になりました。','考前药理学复习效率提高了10倍。','Repasar farmacología antes de exámenes es 10 veces más eficiente.',12],
  [5,'USMLE Step 1 prep: this app is a must-have for med students.','USMLE Step 1 준비에 의대생 필수 앱이에요.','USMLE Step 1対策に医学生必須のアプリです。','USMLE Step 1备考必备，医学生一定要用。','Preparación USMLE Step 1: esta app es imprescindible para estudiantes de medicina.',1],
  [4,'Pathology flash cards saved my grade. Seriously.','병리학 플래시카드가 성적을 살렸어요. 진심으로.','病理学のフラッシュカードに成績を救われました。本当に。','病理学闪卡真的救了我的成绩，不夸张。','Las tarjetas de patología salvaron mi nota. En serio.',1],
  [5,'Clinical rotations are less stressful with organized review decks.','정리된 복습 덱 덕분에 임상 실습이 덜 힘들어요.','整理された復習デッキで臨床実習のストレスが減りました。','有组织的复习牌组让临床实习压力小了很多。','Las rotaciones clínicas son menos estresantes con mazos organizados.',1],
  [5,'Passed NCLEX on first try. Spaced repetition really works.','NCLEX 첫 시도에 합격. 간격 반복은 정말 효과적이에요.','NCLEXに一発合格。間隔反復は本当に効果があります。','NCLEX一次通过，间隔重复真的有效。','Aprobé el NCLEX al primer intento. La repetición espaciada funciona.',9],
  [4,'Drug interaction cards helped me avoid dangerous mistakes.','약물 상호작용 카드가 위험한 실수를 방지해줬어요.','薬物相互作用カードで危険なミスを防げました。','药物相互作用卡帮我避免了危险的错误。','Las tarjetas de interacciones farmacológicas me ayudaron a evitar errores peligrosos.',9],
  [5,'Medical terminology in 3 languages thanks to TTS + SRS combo.','TTS + SRS 조합으로 3개 국어 의학 용어를 익혔어요.','TTS+SRSの組み合わせで3ヶ国語の医学用語を習得。','TTS+SRS组合让我掌握了3种语言的医学术语。','Terminología médica en 3 idiomas gracias a la combinación TTS + SRS.',1],
  [5,'Board exam review has never been this organized.','보드 시험 복습이 이렇게 체계적인 적은 없었어요.','ボード試験の復習がここまで体系的だったことはない。','执照考试复习从来没有这么有条理过。','Repasar para el examen de licencia nunca fue tan organizado.',1],
  [4,'Dental anatomy cards are my go-to before practicals.','실습 전 치과 해부학 카드가 필수예요.','実習前に歯科解剖学カードが欠かせません。','实操前牙科解剖学卡片是我的必备。','Las tarjetas de anatomía dental son mi recurso antes de las prácticas.',1],
  // ── Law & Business (25-34) ──
  [5,'Bar exam prep: memorized 500+ legal rules with SRS.','변호사 시험: SRS로 500개 이상 법률 규정 암기.','司法試験：SRSで500以上の法律規則を暗記。','司法考试：用SRS记住了500多条法律规则。','Preparación para el examen de abogacía: memoricé más de 500 reglas legales con SRS.',13],
  [5,'Contract law terminology finally makes sense to me.','계약법 용어가 드디어 이해가 돼요.','契約法の用語がやっと理解できるようになった。','合同法术语终于能理解了。','La terminología de derecho contractual por fin tiene sentido para mí.',13],
  [4,'Evidence rules are so much easier to recall during mock trials.','모의재판에서 증거법을 훨씬 쉽게 떠올릴 수 있어요.','模擬裁判で証拠法をはるかに簡単に思い出せます。','模拟审判时证据规则更容易回忆了。','Las reglas de evidencia son mucho más fáciles de recordar en simulacros.',13],
  [5,'CPA exam passed on first attempt. SRS made the difference.','CPA 시험 첫 시도 합격. SRS가 결정적이었어요.','CPA試験に一発合格。SRSが決め手でした。','CPA考试一次通过，SRS是关键。','Aprobé el examen CPA al primer intento. El SRS marcó la diferencia.',14],
  [5,'CFA Level 2 formulas stuck in my head thanks to daily reviews.','매일 복습 덕분에 CFA Level 2 공식이 기억에 남아요.','毎日の復習でCFA Level 2の公式が定着。','每日复习让CFA二级公式牢记于心。','Las fórmulas del CFA Nivel 2 se quedaron en mi cabeza gracias a las revisiones diarias.',5],
  [4,'MBA vocabulary cards helped me keep up with case discussions.','MBA 어휘 카드로 사례 토론을 잘 따라갈 수 있었어요.','MBA語彙カードでケーススタディの議論についていけた。','MBA词汇卡帮我跟上了案例讨论。','Las tarjetas de vocabulario MBA me ayudaron a seguir las discusiones de casos.',3],
  [5,'Accounting standards are complex but SRS breaks them down.','회계 기준이 복잡하지만 SRS가 잘 분해해줘요.','会計基準は複雑だけどSRSが分解してくれます。','会计准则很复杂但SRS帮我拆解了。','Las normas contables son complejas pero el SRS las desglosa.',14],
  [5,'Tax law updates: I create a new deck each quarter. So efficient.','세법 개정: 분기마다 새 덱을 만들어요. 정말 효율적.','税法更新：四半期ごとに新デッキを作成。超効率的。','税法更新：每季度做新牌组，超高效。','Actualizaciones fiscales: creo un nuevo mazo cada trimestre. Súper eficiente.',14],
  [4,'Corporate finance concepts finally clicked after 2 weeks of SRS.','2주간 SRS 후 기업 재무 개념이 드디어 이해됐어요.','2週間のSRS後、コーポレートファイナンスの概念がやっと理解できた。','2周SRS后企业财务概念终于理解了。','Los conceptos de finanzas corporativas por fin encajaron tras 2 semanas de SRS.',3],
  [5,'Constitutional law cases are easy to recall now.','헌법 판례를 이제 쉽게 떠올릴 수 있어요.','憲法判例が今は簡単に思い出せます。','宪法案例现在很容易回忆了。','Los casos de derecho constitucional son fáciles de recordar ahora.',13],
  // ── University / Academic (35-49) ──
  [5,'Psychology terms for 200+ concepts, all memorized before finals.','기말 전 200개 이상 심리학 용어 모두 암기.','期末前に200以上の心理学用語をすべて暗記。','期末前记住了200多个心理学术语。','Términos de psicología para más de 200 conceptos, todos memorizados antes de los finales.',2],
  [5,'History dates and events: scored 97 on my exam.','역사 날짜와 사건: 시험에서 97점 받았어요.','歴史の年号と事件：試験で97点獲得。','历史日期和事件：考试得了97分。','Fechas y eventos históricos: saqué 97 en mi examen.',2],
  [4,'Biology classification became manageable with flashcards.','플래시카드로 생물 분류가 관리 가능해졌어요.','フラッシュカードで生物分類が管理しやすくなった。','用闪卡让生物分类变得可控了。','La clasificación biológica se volvió manejable con tarjetas.',2],
  [5,'Organic chemistry reactions: SRS is the only way to survive.','유기화학 반응: SRS만이 살아남는 방법이에요.','有機化学反応：SRSが唯一の生存方法です。','有机化学反应：SRS是唯一的生存之道。','Reacciones de química orgánica: el SRS es la única forma de sobrevivir.',2],
  [5,'Physics formulas for the whole semester in one deck. Lifesaver.','한 학기 물리 공식을 하나의 덱에. 생명의 은인이에요.','一学期分の物理公式を1デッキに。命の恩人です。','一学期的物理公式一个牌组搞定，救命稻草。','Fórmulas de física de todo el semestre en un mazo. Salvavidas.',2],
  [4,'Microeconomics concepts: got an A for the first time.','미시경제학 개념: 처음으로 A를 받았어요.','ミクロ経済学：初めてAを取りました。','微观经济学概念：第一次拿到A。','Conceptos de microeconomía: obtuve una A por primera vez.',2],
  [5,'Sociology vocabulary for my thesis research. Incredibly helpful.','논문 연구용 사회학 어휘. 정말 큰 도움이 됐어요.','論文研究用の社会学語彙。信じられないほど役立った。','论文研究用的社会学词汇，非常有帮助。','Vocabulario de sociología para mi tesis. Increíblemente útil.',3],
  [4,'Philosophy terminology made accessible through spaced repetition.','간격 반복으로 철학 용어가 접근 가능해졌어요.','間隔反復で哲学用語がアクセスしやすくなった。','间隔重复让哲学术语变得易于理解。','La terminología filosófica se hizo accesible con la repetición espaciada.',2],
  [5,'Political science: memorized all 50 key theorists and their views.','정치학: 50명 주요 이론가와 관점 모두 암기.','政治学：50人の主要理論家とその見解を全て暗記。','政治学：记住了50位主要理论家及其观点。','Ciencias políticas: memoricé los 50 teóricos clave y sus ideas.',2],
  [5,'Linguistics phonetic symbols: from confusion to confidence.','언어학 음성 기호: 혼란에서 자신감으로.','言語学の音声記号：混乱から自信へ。','语言学音标：从困惑到自信。','Símbolos fonéticos de lingüística: de la confusión a la confianza.',3],
  [4,'Art history: 300 works and artists organized by period.','미술사: 시대별로 300개 작품과 작가 정리.','美術史：時代別に300の作品と作家を整理。','艺术史：按时期整理了300件作品和艺术家。','Historia del arte: 300 obras y artistas organizados por período.',2],
  [5,'Music theory intervals and chords: perfect recall every time.','음악 이론 음정과 화성: 매번 완벽한 기억.','音楽理論の音程と和音：毎回完璧に思い出せる。','乐理音程和和弦：每次都能完美回忆。','Intervalos y acordes de teoría musical: recuerdo perfecto cada vez.',8],
  [5,'Algorithms and data structures: aced my CS midterm.','알고리즘과 자료구조: 컴공 중간고사 만점.','アルゴリズムとデータ構造：CS中間試験で満点。','算法和数据结构：计算机科学期中满分。','Algoritmos y estructuras de datos: destaqué en mi parcial de informática.',11],
  [4,'Statistics formulas: no more blank stares during exams.','통계학 공식: 시험 때 더 이상 멍하니 보지 않아요.','統計学の公式：試験中にもう呆然としない。','统计学公式：考试时不再发呆了。','Fórmulas de estadística: no más miradas en blanco durante los exámenes.',2],
  [5,'Calculus theorems organized beautifully. Made math enjoyable.','미적분 정리를 깔끔하게 정리. 수학이 재미있어졌어요.','微積分の定理を美しく整理。数学が楽しくなった。','微积分定理整理得很漂亮，数学变得有趣了。','Teoremas de cálculo organizados bellamente. Las matemáticas se volvieron agradables.',2],
  // ── High School (50-59) ──
  [5,'Finals week: reviewed 6 subjects with one app. Total lifesaver.','기말 주간: 하나의 앱으로 6과목 복습. 완전 생명의 은인.','期末週：1つのアプリで6科目を復習。完全に命の恩人。','期末周：一个应用复习6个科目，完全是救星。','Semana de finales: repasé 6 materias con una app. Salvavidas total.',4],
  [5,'AP Chemistry: scored a 5 thanks to systematic flashcard review.','AP 화학: 체계적인 플래시카드 복습 덕분에 5점.','AP化学：体系的なフラッシュカード復習で5点獲得。','AP化学：系统化的闪卡复习让我拿到了5分。','AP Química: saqué un 5 gracias a la revisión sistemática con tarjetas.',4],
  [4,'College entrance prep made less stressful with organized decks.','정리된 덱으로 대학 입시 준비 스트레스가 줄었어요.','整理されたデッキで大学入試準備のストレスが減った。','有条理的牌组让大学入学准备压力减轻了。','Preparar el ingreso a la universidad fue menos estresante con mazos organizados.',4],
  [5,'Science olympiad: memorized 400+ facts for the competition.','과학 올림피아드: 대회용 400개 이상 사실 암기.','科学オリンピック：大会用に400以上の事実を暗記。','科学竞赛：为比赛记住了400多个知识点。','Olimpiada de ciencias: memoricé más de 400 datos para la competencia.',4],
  [5,'Math competition formulas: all in my pocket, ready anytime.','수학 경시대회 공식: 주머니에 넣고 언제든 준비.','数学コンテストの公式：ポケットに入れていつでも準備OK。','数学竞赛公式：随身携带随时准备。','Fórmulas de competencia de matemáticas: todo en mi bolsillo, listo en cualquier momento.',4],
  [4,'French class went from C to A after 2 months of daily SRS.','2개월 매일 SRS 후 프랑스어 수업이 C에서 A로.','2ヶ月の毎日SRS後、フランス語のクラスがCからAに。','每天SRS两个月后法语课从C提升到A。','La clase de francés pasó de C a A después de 2 meses de SRS diario.',4],
  [5,'SAT vocab section: improved 120 points.','SAT 어휘 섹션: 120점 향상.','SAT語彙セクション：120点向上。','SAT词汇部分：提高了120分。','Sección de vocabulario SAT: mejoré 120 puntos.',4],
  [5,'Study routine is finally consistent. The app keeps me on track.','학습 루틴이 드디어 일관적이에요. 앱이 꾸준히 관리해줘요.','学習ルーティンがやっと安定した。アプリが管理してくれる。','学习作息终于固定了，应用帮我保持节奏。','Mi rutina de estudio por fin es constante. La app me mantiene en el camino.',4],
  [4,'GPA went from 3.2 to 3.8 in one semester.','한 학기에 GPA가 3.2에서 3.8로 올랐어요.','1学期でGPAが3.2から3.8に上昇。','一个学期GPA从3.2提升到3.8。','Mi promedio subió de 3.2 a 3.8 en un semestre.',4],
  [5,'My teacher noticed the improvement and asked what I changed!','선생님이 발전을 알아채시고 뭘 바꿨냐고 물어보셨어요!','先生が上達に気づいて何を変えたか聞いてきました！','老师注意到了进步问我做了什么改变！','¡Mi profesor notó la mejora y me preguntó qué cambié!',4],
  // ── Tech & Engineering (60-69) ──
  [5,'AWS certification: 200 service cards helped me pass Solutions Architect.','AWS 자격증: 200개 서비스 카드로 Solutions Architect 합격.','AWS認定：200のサービスカードでSolutions Architectに合格。','AWS认证：200张服务卡帮我通过了Solutions Architect。','Certificación AWS: 200 tarjetas de servicios me ayudaron a aprobar Solutions Architect.',10],
  [5,'Coding interview patterns: memorized 50 LeetCode patterns.','코딩 인터뷰 패턴: LeetCode 패턴 50개 암기.','コーディング面接パターン：LeetCodeパターン50個暗記。','编程面试模式：记住了50个LeetCode模式。','Patrones de entrevistas de programación: memoricé 50 patrones de LeetCode.',11],
  [5,'System design concepts: finally confident in interviews.','시스템 설계 개념: 드디어 면접에서 자신감 생겼어요.','システム設計の概念：やっと面接で自信が持てる。','系统设计概念：面试终于有信心了。','Conceptos de diseño de sistemas: por fin con confianza en las entrevistas.',11],
  [4,'Data structures review before whiteboard interviews. Essential.','화이트보드 면접 전 자료구조 복습. 필수예요.','ホワイトボード面接前のデータ構造復習。必須です。','白板面试前的数据结构复习，必不可少。','Repaso de estructuras de datos antes de entrevistas de pizarra. Esencial.',11],
  [5,'Cloud computing terms across AWS, GCP, and Azure in one deck.','AWS, GCP, Azure 클라우드 용어를 하나의 덱에.','AWS、GCP、Azureのクラウド用語を1デッキに。','AWS、GCP、Azure云计算术语一个牌组搞定。','Términos de computación en la nube de AWS, GCP y Azure en un solo mazo.',10],
  [5,'Cybersecurity frameworks and protocols: exam ready in 3 weeks.','보안 프레임워크와 프로토콜: 3주 만에 시험 준비 완료.','セキュリティフレームワークとプロトコル：3週間で試験準備完了。','安全框架和协议：3周内准备好考试。','Marcos y protocolos de ciberseguridad: listo para el examen en 3 semanas.',10],
  [4,'DevOps tools and commands: kubectl, terraform, all memorized.','DevOps 도구와 명령어: kubectl, terraform 모두 암기.','DevOpsツールとコマンド：kubectl、terraform全て暗記。','DevOps工具和命令：kubectl、terraform全记住了。','Herramientas y comandos DevOps: kubectl, terraform, todo memorizado.',11],
  [5,'Machine learning algorithms and their use cases, crystal clear.','머신러닝 알고리즘과 활용 사례가 명확해졌어요.','機械学習アルゴリズムとその活用事例が明確に。','机器学习算法及其应用场景变得清晰了。','Algoritmos de machine learning y sus casos de uso, clarísimos.',10],
  [4,'SQL queries: complex JOINs are second nature now.','SQL 쿼리: 복잡한 JOIN이 이제 자연스러워요.','SQLクエリ：複雑なJOINが今は自然にできる。','SQL查询：复杂的JOIN现在已经是第二天性了。','Consultas SQL: los JOINs complejos son algo natural ahora.',11],
  [5,'Kubernetes concepts for CKA exam. Passed with 92%.','CKA 시험용 쿠버네티스 개념. 92%로 합격.','CKA試験用のKubernetes概念。92%で合格。','CKA考试的Kubernetes概念，92%通过。','Conceptos de Kubernetes para el examen CKA. Aprobé con 92%.',10],
  // ── Self-learning & Hobby (70-79) ──
  [4,'Wine regions and grape varieties for my sommelier course.','소믈리에 과정용 와인 산지와 포도 품종 학습.','ソムリエコース用のワイン産地とブドウ品種。','侍酒师课程的葡萄酒产区和葡萄品种。','Regiones vinícolas y variedades de uva para mi curso de sommelier.',8],
  [5,'World history as a hobby: 500 events organized by century.','취미로 세계사: 세기별로 500개 사건 정리.','趣味で世界史：世紀別に500の出来事を整理。','爱好世界史：按世纪整理了500个事件。','Historia mundial como hobby: 500 eventos organizados por siglo.',8],
  [4,'Trivia night champion 3 weeks in a row thanks to my decks.','내 덱 덕분에 3주 연속 퀴즈 나이트 챔피언.','デッキのおかげで3週連続トリビアナイトチャンピオン。','多亏了我的牌组，连续3周问答之夜冠军。','Campeón de noche de trivia 3 semanas seguidas gracias a mis mazos.',8],
  [5,'Travel Japanese: enough to navigate Tokyo without Google Translate.','여행 일본어: 구글 번역 없이 도쿄를 돌아다닐 수 있어요.','旅行日本語：Google翻訳なしで東京を歩けるレベルに。','旅游日语：不用谷歌翻译就能在东京转悠了。','Japonés para viajes: suficiente para recorrer Tokio sin Google Translate.',8],
  [5,'Bird species identification: know 200+ North American birds now.','조류 식별: 북미 200종 이상의 새를 알게 됐어요.','鳥類識別：北米の200種以上の鳥を覚えました。','鸟类识别：现在认识200多种北美鸟类了。','Identificación de aves: ahora conozco más de 200 aves norteamericanas.',8],
  [4,'Cooking terminology in French and Italian for my culinary passion.','요리 열정을 위한 프랑스어·이탈리아어 요리 용어.','料理への情熱のためのフランス語・イタリア語の料理用語。','为了烹饪热情学的法语和意大利语烹饪术语。','Terminología culinaria en francés e italiano para mi pasión por la cocina.',8],
  [5,'Photography settings and techniques: finally shooting in manual mode.','사진 설정과 기법: 드디어 수동 모드로 촬영해요.','写真の設定とテクニック：やっとマニュアルモードで撮影。','摄影设置和技巧：终于能用手动模式拍摄了。','Ajustes y técnicas de fotografía: por fin disparo en modo manual.',8],
  [5,'Guitar chord progressions and scales: practice sessions are so productive.','기타 코드 진행과 스케일: 연습이 정말 생산적이에요.','ギターのコード進行とスケール：練習がとても生産的に。','吉他和弦进行和音阶：练习变得非常高效。','Progresiones de acordes y escalas de guitarra: las sesiones de práctica son muy productivas.',8],
  [4,'Gardening: plant care schedules and soil types all organized.','원예: 식물 관리 일정과 토양 유형 모두 정리.','園芸：植物管理スケジュールと土壌タイプを全て整理。','园艺：植物养护时间和土壤类型全部整理好了。','Jardinería: horarios de cuidado de plantas y tipos de suelo organizados.',8],
  [5,'Home repair terms and techniques. Saved thousands on contractors.','주택 수리 용어와 기법. 업자 비용 수백만 원 절약.','住宅修繕の用語とテクニック。業者費用を大幅節約。','家庭维修术语和技巧，省了好几千的工人费。','Términos y técnicas de reparación del hogar. Ahorré miles en contratistas.',5],
  // ── Feature-specific Praise (80-89) ──
  [5,'Deck sharing is incredible. Found a perfect deck for every subject.','덱 공유가 놀라워요. 모든 과목 완벽한 덱을 찾았어요.','デッキ共有が素晴らしい。全科目の完璧なデッキを発見。','牌组分享太棒了，每个科目都找到了完美的牌组。','Compartir mazos es increíble. Encontré un mazo perfecto para cada materia.',2],
  [5,'The statistics dashboard keeps me motivated. Love the streak counter.','통계 대시보드가 동기부여가 돼요. 연속 학습 카운터 최고.','統計ダッシュボードがモチベーション維持に。連続学習カウンター最高。','统计仪表盘让我保持动力，连续学习计数器太好了。','El panel de estadísticas me mantiene motivado. Me encanta el contador de racha.',5],
  [5,'TTS in 5 languages is a game changer for pronunciation practice.','5개 국어 TTS는 발음 연습의 혁명이에요.','5ヶ国語のTTSは発音練習の革命です。','5种语言的TTS对发音练习来说是革命性的。','TTS en 5 idiomas es un cambio total para practicar pronunciación.',0],
  [4,'Using it on mobile during my commute. 30 minutes well spent daily.','출퇴근 시 모바일로 사용. 매일 30분을 잘 활용해요.','通勤中にモバイルで使用。毎日30分を有効活用。','通勤时用手机学习，每天30分钟物超所值。','Lo uso en el móvil durante mi trayecto. 30 minutos bien aprovechados al día.',5],
  [5,'CSV import saved me hours. Uploaded my entire study spreadsheet.','CSV 가져오기로 시간을 절약. 전체 스프레드시트 업로드.','CSVインポートで何時間も節約。学習スプレッドシート全体をアップロード。','CSV导入节省了好几个小时，上传了整个学习表格。','La importación CSV me ahorró horas. Subí toda mi hoja de estudio.',3],
  [5,'5 study modes means I never get bored. Variety keeps me engaged.','5가지 학습 모드라 지루할 틈이 없어요. 다양성이 좋아요.','5つの学習モードで飽きることがない。多様性が魅力。','5种学习模式让我永远不会无聊，多样性很吸引人。','5 modos de estudio significan que nunca me aburro. La variedad me mantiene enganchado.',2],
  [5,'The cleanest study app UI I have ever used. No clutter at all.','지금까지 사용한 학습 앱 중 가장 깔끔한 UI. 전혀 복잡하지 않아요.','今まで使った中で最もクリーンなUIの学習アプリ。全く散らかっていない。','我用过的最干净的学习应用UI，完全没有杂乱感。','La interfaz más limpia de cualquier app de estudio que he usado. Sin desorden.',11],
  [4,'Fast and reliable. Never crashed once in 6 months of daily use.','빠르고 안정적. 6개월 매일 사용하는데 한 번도 안 멈췄어요.','速くて安定。6ヶ月毎日使って一度もクラッシュなし。','快速又稳定，6个月每天使用一次都没崩溃过。','Rápida y fiable. Nunca se colgó en 6 meses de uso diario.',5],
  [5,'Custom templates let me structure cards exactly how I want.','커스텀 템플릿으로 카드를 원하는 대로 구성할 수 있어요.','カスタムテンプレートでカードを思い通りに構成できる。','自定义模板让我按想要的方式构建卡片。','Las plantillas personalizadas me permiten estructurar las tarjetas como quiero.',6],
  [5,'The community marketplace decks saved me weeks of card creation.','커뮤니티 마켓플레이스 덱으로 수주간의 카드 제작 시간 절약.','コミュニティマーケットプレイスのデッキで何週間もの作成時間を節約。','社区市场的牌组为我节省了好几周的制卡时间。','Los mazos del marketplace comunitario me ahorraron semanas de crear tarjetas.',2],
  // ── General SRS & Comparison Praise (90-99) ──
  [5,'The interface is so clean and intuitive. Studying feels effortless now.','인터페이스가 깔끔하고 직관적이에요. 학습이 수월해졌어요.','インターフェースがとてもクリーンで直感的。学習が楽になった。','界面很干净直观，学习变得毫不费力。','La interfaz es tan limpia e intuitiva. Estudiar se siente sin esfuerzo ahora.',8],
  [5,'Study time cut in half, retention doubled. The math speaks for itself.','학습 시간 반으로 줄고 기억력 두 배. 결과가 말해줘요.','学習時間半分、記憶力2倍。結果が全てを物語る。','学习时间减半，记忆力翻倍，数据说明一切。','Tiempo de estudio reducido a la mitad, retención duplicada. Los números hablan solos.',5],
  [5,'3 months in and I barely forget anything I study. SRS is magic.','3개월째인데 공부한 걸 거의 잊지 않아요. SRS는 마법이에요.','3ヶ月経っても学習した内容をほとんど忘れない。SRSは魔法。','用了3个月几乎不忘记学过的内容，SRS太神奇了。','3 meses usando y casi no olvido nada de lo que estudio. El SRS es magia.',2],
  [4,'My memory used to be terrible. This app completely changed that.','기억력이 끔찍했는데 이 앱이 완전히 바꿔놨어요.','記憶力がひどかったのに、このアプリが完全に変えてくれた。','我以前记性很差，这个应用完全改变了这一点。','Mi memoria solía ser terrible. Esta app cambió eso por completo.',5],
  [5,'The daily review habit keeps me consistent. 180-day streak and counting.','매일 복습 습관으로 꾸준해요. 180일 연속 학습 중.','毎日の復習習慣で一貫性を維持。180日連続学習中。','每日复习习惯让我保持一致，已经连续180天了。','El hábito de repaso diario me mantiene constante. Racha de 180 días y contando.',8],
  [5,'Made learning fun again. I actually look forward to my daily reviews.','학습이 다시 재미있어졌어요. 매일 복습이 기대돼요.','学習がまた楽しくなった。毎日の復習が楽しみ。','学习又变得有趣了，每天都期待复习。','Hizo que aprender fuera divertido otra vez. Espero con ganas mis repasos diarios.',2],
  [5,'Recommended to all my classmates. 8 of them signed up already.','같은 반 친구들에게 추천. 이미 8명이 가입했어요.','クラスメート全員に推薦。すでに8人が登録。','推荐给所有同学了，已经有8个人注册了。','Se lo recomendé a todos mis compañeros. 8 de ellos ya se registraron.',2],
  [5,'This app changed how I approach learning. Genuinely life-changing.','이 앱이 학습에 대한 접근 방식을 바꿨어요. 정말 인생이 바뀌었어요.','このアプリが学習へのアプローチを変えた。本当に人生が変わった。','这个应用改变了我的学习方式，真正改变了我的人生。','Esta app cambió mi enfoque del aprendizaje. Genuinamente transformador.',3],
  [4,'Wish I found this 2 years ago. Would have saved so much time.','2년 전에 알았으면. 시간을 엄청 절약했을 텐데.','2年前に見つけていたら。かなりの時間を節約できたのに。','要是两年前就发现就好了，能节省好多时间。','Ojalá hubiera encontrado esto hace 2 años. Habría ahorrado mucho tiempo.',7],
  [5,'Best study tool I have ever used. Period. Worth every minute spent.','지금까지 사용한 최고의 학습 도구. 투자한 시간이 아깝지 않아요.','今まで使った中で最高の学習ツール。費やした時間に見合う価値。','我用过的最好的学习工具，花的每一分钟都值得。','La mejor herramienta de estudio que he usado. Punto. Vale cada minuto invertido.',5],
]

// DATA quote order: [rating, en, ko, ja, zh, es, roleIdx]
const QUOTE_LOCALE_ORDER = ['en', 'ko', 'ja', 'zh', 'es'] as const
const ROLE_IDX_POS = QUOTE_LOCALE_ORDER.length + 1 // index 6

export const REVIEWS: Review[] = DATA.map((d, i) => ({
  rating: d[0],
  quote: Object.fromEntries(
    SUPPORTED_LOCALES.map((lang) => {
      const qi = QUOTE_LOCALE_ORDER.indexOf(lang as typeof QUOTE_LOCALE_ORDER[number])
      return [lang, qi >= 0 ? d[1 + qi] : d[1]] // fallback to en
    }),
  ) as Localized,
  author: Object.fromEntries(
    SUPPORTED_LOCALES.map((lang) => {
      const pool = NAME_POOLS[lang] ?? NAME_POOLS.en
      return [lang, pool[i % pool.length]]
    }),
  ) as Localized,
  role: Object.fromEntries(
    SUPPORTED_LOCALES.map((lang) => {
      const r = R[d[ROLE_IDX_POS] as number]
      return [lang, r[lang as keyof typeof r] ?? r.en]
    }),
  ) as Localized,
  color: COLORS[i % COLORS.length],
}))
