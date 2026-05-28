import type { DeckCategory } from "@/domain/value-objects/DeckCategory";
import type { LanguageCode } from "@/domain/value-objects/LanguageCode";

/**
 * SSOT for localized official-deck titles & descriptions.
 *
 * Rule (see DOCS/TODO/2026-05-28-i18n-deck-marketplace.md): the display
 * language of a deck's name/description is the **non-English side** of its
 * language pair — i.e. the learner's mother tongue. Every official deck teaches
 * English, so the pair is always en↔X and the audience language is X. Forward
 * (en→X), reverse (X→en), and conversation (ko→en) decks all render in X.
 *
 * The direction suffix `(src → tgt)` disambiguates the forward and reverse decks
 * (which share a base name) and is itself rendered in the audience language.
 */

/** The learner's mother tongue = the non-English side of the pair. */
export function audienceLanguage(
  source: LanguageCode,
  target: LanguageCode,
): LanguageCode {
  return source === "en" ? target : source;
}

/** Each audience language's word for each supported language (for the
 *  `(src → tgt)` direction suffix). */
const LANGUAGE_NAMES: Record<LanguageCode, Record<LanguageCode, string>> = {
  en: { en: "English", ko: "Korean", ja: "Japanese", zh: "Chinese", es: "Spanish", vi: "Vietnamese", th: "Thai", id: "Indonesian" },
  ko: { en: "영어", ko: "한국어", ja: "일본어", zh: "중국어", es: "스페인어", vi: "베트남어", th: "태국어", id: "인도네시아어" },
  ja: { en: "英語", ko: "韓国語", ja: "日本語", zh: "中国語", es: "スペイン語", vi: "ベトナム語", th: "タイ語", id: "インドネシア語" },
  zh: { en: "英语", ko: "韩语", ja: "日语", zh: "中文", es: "西班牙语", vi: "越南语", th: "泰语", id: "印尼语" },
  es: { en: "inglés", ko: "coreano", ja: "japonés", zh: "chino", es: "español", vi: "vietnamita", th: "tailandés", id: "indonesio" },
  vi: { en: "tiếng Anh", ko: "tiếng Hàn", ja: "tiếng Nhật", zh: "tiếng Trung", es: "tiếng Tây Ban Nha", vi: "tiếng Việt", th: "tiếng Thái", id: "tiếng Indonesia" },
  th: { en: "อังกฤษ", ko: "เกาหลี", ja: "ญี่ปุ่น", zh: "จีน", es: "สเปน", vi: "เวียดนาม", th: "ไทย", id: "อินโดนีเซีย" },
  id: { en: "Inggris", ko: "Korea", ja: "Jepang", zh: "Mandarin", es: "Spanyol", vi: "Vietnam", th: "Thailand", id: "Indonesia" },
};

interface MetaStrings {
  readonly catBeginner: string;
  readonly catIntermediate: string;
  readonly catAdvanced: string;
  readonly catGeneral: string;
  /** Appended to a vocab category name. Contains `{n}`. */
  readonly batchSuffix: string;
  /** Contains `{exam}` and `{level}`. */
  readonly examTitle: string;
  /** Contains `{exam}`. */
  readonly examTitleNoLevel: string;
  /** Contains `{label}`. */
  readonly convTitle: string;
  readonly convTitleNoLabel: string;
  /** Contains `{src}` and `{tgt}`. */
  readonly direction: string;
  readonly descVocab: string;
  /** Contains `{exam}`. */
  readonly descExam: string;
  readonly descConversation: string;
}

const STRINGS: Record<LanguageCode, MetaStrings> = {
  en: {
    catBeginner: "Beginner English Vocabulary",
    catIntermediate: "Intermediate English Vocabulary",
    catAdvanced: "Advanced English Vocabulary",
    catGeneral: "Essential English Vocabulary",
    batchSuffix: " — Batch {n}",
    examTitle: "{exam} {level} Vocabulary",
    examTitleNoLevel: "{exam} Vocabulary",
    convTitle: "Real English Conversation — {label}",
    convTitleNoLabel: "Real English Conversation",
    direction: " ({src} → {tgt})",
    descVocab: "An official deck for learning essential English words with meanings and examples.",
    descExam: "An official deck of core {exam} exam vocabulary with words, meanings, and example sentences.",
    descConversation: "An official deck of real-life English conversation expressions with natural translations and notes.",
  },
  ko: {
    catBeginner: "초급 영단어",
    catIntermediate: "중급 영단어",
    catAdvanced: "고급 영단어",
    catGeneral: "필수 영단어",
    batchSuffix: " — {n}탄",
    examTitle: "{exam} {level} 어휘",
    examTitleNoLevel: "{exam} 어휘",
    convTitle: "실전 영어 회화 — {label}",
    convTitleNoLabel: "실전 영어 회화",
    direction: " ({src} → {tgt})",
    descVocab: "자주 쓰이는 영어 단어를 뜻과 예문으로 함께 익히는 공식 학습덱입니다.",
    descExam: "{exam} 시험에 자주 나오는 핵심 어휘를 예문과 함께 학습하는 공식 덱입니다.",
    descConversation: "실생활에서 바로 쓰는 영어 회화 표현을 자연스러운 번역과 설명으로 익히는 공식 덱입니다.",
  },
  ja: {
    catBeginner: "初級英単語",
    catIntermediate: "中級英単語",
    catAdvanced: "上級英単語",
    catGeneral: "必須英単語",
    batchSuffix: " — 第{n}弾",
    examTitle: "{exam} {level} 単語",
    examTitleNoLevel: "{exam} 単語",
    convTitle: "リアル英会話 — {label}",
    convTitleNoLabel: "リアル英会話",
    direction: "（{src} → {tgt}）",
    descVocab: "よく使う英単語を意味と例文で学べる公式デッキです。",
    descExam: "{exam}試験で頻出の重要単語を例文とともに学べる公式デッキです。",
    descConversation: "日常ですぐ使える英会話表現を自然な訳と解説で学べる公式デッキです。",
  },
  zh: {
    catBeginner: "初级英语词汇",
    catIntermediate: "中级英语词汇",
    catAdvanced: "高级英语词汇",
    catGeneral: "核心英语词汇",
    batchSuffix: " — 第{n}辑",
    examTitle: "{exam} {level} 词汇",
    examTitleNoLevel: "{exam} 词汇",
    convTitle: "实用英语会话 — {label}",
    convTitleNoLabel: "实用英语会话",
    direction: "（{src} → {tgt}）",
    descVocab: "通过释义和例句学习常用英语单词的官方卡组。",
    descExam: "收录 {exam} 考试高频核心词汇并配有例句的官方卡组。",
    descConversation: "学习日常生活中即可使用的英语会话表达，附自然翻译与说明的官方卡组。",
  },
  es: {
    catBeginner: "Vocabulario de inglés básico",
    catIntermediate: "Vocabulario de inglés intermedio",
    catAdvanced: "Vocabulario de inglés avanzado",
    catGeneral: "Vocabulario esencial de inglés",
    batchSuffix: " — Lote {n}",
    examTitle: "Vocabulario {exam} {level}",
    examTitleNoLevel: "Vocabulario {exam}",
    convTitle: "Conversación real en inglés — {label}",
    convTitleNoLabel: "Conversación real en inglés",
    direction: " ({src} → {tgt})",
    descVocab: "Una baraja oficial para aprender palabras esenciales del inglés con significados y ejemplos.",
    descExam: "Una baraja oficial con vocabulario clave del examen {exam}, con palabras, significados y ejemplos.",
    descConversation: "Una baraja oficial de expresiones reales de conversación en inglés con traducciones naturales y notas.",
  },
  vi: {
    catBeginner: "Từ vựng tiếng Anh cơ bản",
    catIntermediate: "Từ vựng tiếng Anh trung cấp",
    catAdvanced: "Từ vựng tiếng Anh nâng cao",
    catGeneral: "Từ vựng tiếng Anh thiết yếu",
    batchSuffix: " — Phần {n}",
    examTitle: "Từ vựng {exam} {level}",
    examTitleNoLevel: "Từ vựng {exam}",
    convTitle: "Hội thoại tiếng Anh thực tế — {label}",
    convTitleNoLabel: "Hội thoại tiếng Anh thực tế",
    direction: " ({src} → {tgt})",
    descVocab: "Bộ thẻ chính thức giúp học từ vựng tiếng Anh thiết yếu kèm nghĩa và ví dụ.",
    descExam: "Bộ thẻ chính thức gồm từ vựng trọng tâm của kỳ thi {exam}, kèm ví dụ.",
    descConversation: "Bộ thẻ chính thức gồm các mẫu hội thoại tiếng Anh thực tế kèm bản dịch tự nhiên và ghi chú.",
  },
  th: {
    catBeginner: "คำศัพท์ภาษาอังกฤษระดับต้น",
    catIntermediate: "คำศัพท์ภาษาอังกฤษระดับกลาง",
    catAdvanced: "คำศัพท์ภาษาอังกฤษระดับสูง",
    catGeneral: "คำศัพท์ภาษาอังกฤษที่จำเป็น",
    batchSuffix: " — ชุดที่ {n}",
    examTitle: "คำศัพท์ {exam} {level}",
    examTitleNoLevel: "คำศัพท์ {exam}",
    convTitle: "บทสนทนาภาษาอังกฤษในชีวิตจริง — {label}",
    convTitleNoLabel: "บทสนทนาภาษาอังกฤษในชีวิตจริง",
    direction: " ({src} → {tgt})",
    descVocab: "เด็คทางการสำหรับเรียนคำศัพท์ภาษาอังกฤษที่จำเป็น พร้อมความหมายและตัวอย่างประโยค",
    descExam: "เด็คทางการที่รวบรวมคำศัพท์สำคัญสำหรับการสอบ {exam} พร้อมตัวอย่างประโยค",
    descConversation: "เด็คทางการที่รวบรวมสำนวนบทสนทนาภาษาอังกฤษที่ใช้ได้จริง พร้อมคำแปลที่เป็นธรรมชาติและคำอธิบาย",
  },
  id: {
    catBeginner: "Kosakata Bahasa Inggris Dasar",
    catIntermediate: "Kosakata Bahasa Inggris Menengah",
    catAdvanced: "Kosakata Bahasa Inggris Lanjutan",
    catGeneral: "Kosakata Bahasa Inggris Penting",
    batchSuffix: " — Bagian {n}",
    examTitle: "Kosakata {exam} {level}",
    examTitleNoLevel: "Kosakata {exam}",
    convTitle: "Percakapan Bahasa Inggris Nyata — {label}",
    convTitleNoLabel: "Percakapan Bahasa Inggris Nyata",
    direction: " ({src} → {tgt})",
    descVocab: "Dek resmi untuk mempelajari kosakata penting bahasa Inggris beserta arti dan contoh kalimat.",
    descExam: "Dek resmi berisi kosakata inti ujian {exam}, lengkap dengan contoh kalimat.",
    descConversation: "Dek resmi berisi ungkapan percakapan bahasa Inggris yang nyata dengan terjemahan alami dan catatan.",
  },
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

function batchNumber(level: string | null): string | null {
  if (level === null) return null;
  const match = /^batch-(\d+)$/.exec(level);
  return match ? (match[1] ?? null) : null;
}

function categoryBase(
  s: MetaStrings,
  category: DeckCategory,
  level: string | null,
): string {
  const batch = batchNumber(level);
  switch (category) {
    case "beginner":
      return batch ? s.catBeginner + fill(s.batchSuffix, { n: batch }) : s.catBeginner;
    case "intermediate":
      return batch ? s.catIntermediate + fill(s.batchSuffix, { n: batch }) : s.catIntermediate;
    case "advanced":
      return batch ? s.catAdvanced + fill(s.batchSuffix, { n: batch }) : s.catAdvanced;
    case "ielts":
    case "toefl":
    case "toeic": {
      const exam = category.toUpperCase();
      return level
        ? fill(s.examTitle, { exam, level })
        : fill(s.examTitleNoLevel, { exam });
    }
    case "conversation":
      return level ? fill(s.convTitle, { label: level }) : s.convTitleNoLabel;
    case "general":
      return s.catGeneral;
  }
}

/** Localized deck name in the learner's mother tongue, with a direction suffix. */
export function localizedDeckName(
  category: DeckCategory,
  level: string | null,
  source: LanguageCode,
  target: LanguageCode,
): string {
  const audience = audienceLanguage(source, target);
  const s = STRINGS[audience];
  const base = categoryBase(s, category, level);
  const names = LANGUAGE_NAMES[audience];
  const direction = fill(s.direction, {
    src: names[source],
    tgt: names[target],
  });
  return `${base}${direction}`;
}

/** Localized deck description in the learner's mother tongue. Kept symmetric
 *  with {@link localizedDeckName}; `level` is accepted for call-site parity but
 *  the description copy is category-level (the title already carries the level). */
export function localizedDeckDescription(
  category: DeckCategory,
  _level: string | null,
  source: LanguageCode,
  target: LanguageCode,
): string {
  const audience = audienceLanguage(source, target);
  const s = STRINGS[audience];
  switch (category) {
    case "conversation":
      return s.descConversation;
    case "ielts":
    case "toefl":
    case "toeic":
      return fill(s.descExam, { exam: category.toUpperCase() });
    default:
      return s.descVocab;
  }
}
