import {
  type DeckCategory,
  inferCategoryFromFilename,
  inferLevelFromFilename,
} from "@/domain/value-objects/DeckCategory";
import type { LanguageCode } from "@/domain/value-objects/LanguageCode";
import type { LanguagePair } from "@/domain/value-objects/LanguagePair";
import {
  type CardTemplateId,
  PHRASE_TEMPLATE_ID,
  REVERSE_WORD_TEMPLATE_ID,
  WORD_TEMPLATE_ID,
} from "@/domain/entities/OfficialDeck";

export interface DeckMetadata {
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly icon: string;
  readonly category: DeckCategory;
  readonly tags: readonly string[];
  readonly templateKind: "word" | "phrase";
  readonly templateId: CardTemplateId;
  readonly learningLanguage: LanguageCode;
}

const CATEGORY_COLOR: Record<DeckCategory, string> = {
  beginner: "#10b981",
  intermediate: "#f59e0b",
  advanced: "#ef4444",
  ielts: "#8b5cf6",
  toefl: "#3b82f6",
  toeic: "#0ea5e9",
  conversation: "#ec4899",
  general: "#6b7280",
};

const CATEGORY_ICON: Record<DeckCategory, string> = {
  beginner: "🌱",
  intermediate: "🌿",
  advanced: "🌳",
  ielts: "🎓",
  toefl: "📘",
  toeic: "📗",
  conversation: "💬",
  general: "📚",
};

const LANG_NAME_EN: Record<LanguageCode, string> = {
  en: "English",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  es: "Spanish",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
};

export function buildDeckMetadata(
  filename: string,
  pair: LanguagePair,
): DeckMetadata {
  const category = inferCategoryFromFilename(filename);
  const level = inferLevelFromFilename(filename);
  const isConversation = category === "conversation";
  const templateKind = isConversation ? "phrase" : "word";
  // Reverse-direction word deck: a word deck whose answer (back/target) is
  // English (e.g. ko→en). These are generated native-first and voice English,
  // pairing with the forward en→X decks so both study directions exist.
  const isReverseWord = !isConversation && pair.target === "en";
  const templateId: CardTemplateId = isConversation
    ? PHRASE_TEMPLATE_ID
    : isReverseWord
      ? REVERSE_WORD_TEMPLATE_ID
      : WORD_TEMPLATE_ID;

  const direction = `${pair.source.toUpperCase()} → ${pair.target.toUpperCase()}`;

  // Every official deck teaches English, regardless of study direction.
  const learningLanguage: LanguageCode =
    pair.source === "en" || pair.target === "en" ? "en" : pair.target;

  const tags: string[] = [
    "official",
    `category:${category}`,
    `lang:${pair.source}-${pair.target}`,
    `source:${pair.source}`,
    `target:${pair.target}`,
    `learning_language:${learningLanguage}`,
  ];
  if (level !== null) {
    tags.push(`level:${level}`);
  }

  const name = buildName(category, level, direction);
  const description = buildDescription(category, level, pair);

  return {
    name,
    description,
    color: CATEGORY_COLOR[category],
    icon: CATEGORY_ICON[category],
    category,
    tags,
    templateKind,
    templateId,
    learningLanguage,
  };
}

function buildName(
  category: DeckCategory,
  level: string | null,
  direction: string,
): string {
  const base = (() => {
    switch (category) {
      case "beginner":
        return level && level.startsWith("batch-")
          ? `Beginner Vocabulary — ${formatBatchLevel(level)}`
          : "Beginner Vocabulary";
      case "intermediate":
        return `Intermediate Vocabulary — ${formatBatchLevel(level)}`;
      case "advanced":
        return `Advanced Vocabulary — ${formatBatchLevel(level)}`;
      case "ielts":
        return level ? `IELTS ${level}` : "IELTS Vocabulary";
      case "toefl":
        return level ? `TOEFL ${level}` : "TOEFL Vocabulary";
      case "toeic":
        return level ? `TOEIC ${level}` : "TOEIC Vocabulary";
      case "conversation":
        return level ? `Real Conversation — ${level}` : "Real Conversation";
      case "general":
        return "Vocabulary";
    }
  })();
  return `${base} (${direction})`;
}

function formatBatchLevel(level: string | null): string {
  if (level === null) return "";
  const match = /^batch-(\d+)$/.exec(level);
  if (match) return `Batch ${match[1]}`;
  return level;
}

function buildDescription(
  category: DeckCategory,
  level: string | null,
  pair: LanguagePair,
): string {
  const src = LANG_NAME_EN[pair.source];
  const tgt = LANG_NAME_EN[pair.target];
  const levelClause = level ? ` (level ${level})` : "";
  switch (category) {
    case "conversation":
      return `Curated ${src} conversational expressions${levelClause} with ${tgt} translations and notes.`;
    case "ielts":
    case "toefl":
    case "toeic":
      return `${category.toUpperCase()} exam vocabulary${levelClause}: ${src} word and example, with ${tgt} meaning and example.`;
    default:
      return `${capitalize(category)} ${src} vocabulary${levelClause} with ${tgt} meanings and examples.`;
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}
