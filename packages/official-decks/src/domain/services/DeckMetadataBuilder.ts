import {
  type DeckCategory,
  inferCategoryFromFilename,
  inferLevelFromFilename,
} from "@/domain/value-objects/DeckCategory";
import type { LanguageCode } from "@/domain/value-objects/LanguageCode";
import type { LanguagePair } from "@/domain/value-objects/LanguagePair";
import {
  localizedDeckDescription,
  localizedDeckName,
} from "@/domain/services/DeckMetadataI18n";
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
  /** Native (explanation / back-side) language(s). Rule: front=learning, back=
   *  native. Forward EN→X ⇒ [X]; reverse vocab X→EN ⇒ ['en'] (explanation is
   *  English, for English natives); reverse conversation ⇒ [source] (native-
   *  production deck, e.g. a Korean speaker practising English). */
  readonly nativeLanguages: readonly LanguageCode[];
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

  // Every official deck teaches English, regardless of study direction.
  const learningLanguage: LanguageCode =
    pair.source === "en" || pair.target === "en" ? "en" : pair.target;

  // Native (mother-tongue) language = the non-English side of the pair (the
  // language the learner already speaks). Every official deck teaches English,
  // so the pair is always en↔X. Forward EN→X ⇒ [X]; reverse X→EN and
  // conversation X→EN ⇒ [X]. This keeps native_languages aligned with the
  // deck's display title (rendered in that same mother tongue) and the
  // marketplace native filter — a learner filtering by their own language sees
  // both study directions (recognition en→X and production X→en) of the same
  // English content, instead of the reverse decks being hidden under 'en'.
  const nativeLanguages: readonly LanguageCode[] =
    pair.source === "en" ? [pair.target] : [pair.source];

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

  const name = localizedDeckName(category, level, pair.source, pair.target);
  const description = localizedDeckDescription(
    category,
    level,
    pair.source,
    pair.target,
  );

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
    nativeLanguages,
  };
}

