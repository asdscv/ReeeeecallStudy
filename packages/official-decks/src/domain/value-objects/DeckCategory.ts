export const DECK_CATEGORIES = [
  "beginner",
  "intermediate",
  "advanced",
  "ielts",
  "toefl",
  "toeic",
  "conversation",
  "general",
] as const;

export type DeckCategory = (typeof DECK_CATEGORIES)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(DECK_CATEGORIES);

export function isDeckCategory(value: unknown): value is DeckCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

export function inferCategoryFromFilename(filename: string): DeckCategory {
  const lower = filename.toLowerCase();
  if (lower.startsWith("beginner_batch") || lower.startsWith("english-beginner")) {
    return "beginner";
  }
  if (lower.startsWith("intermediate_batch")) return "intermediate";
  if (lower.startsWith("advanced_batch")) return "advanced";
  if (lower.startsWith("ielts")) return "ielts";
  if (lower.startsWith("toefl")) return "toefl";
  if (lower.startsWith("toeic")) return "toeic";
  if (lower.startsWith("real-conversation")) return "conversation";
  return "general";
}

/**
 * Returns a human-readable level descriptor extracted from the filename,
 * or null when the filename does not encode a level.
 *
 * Examples:
 *   beginner_batch1.csv      → "batch-1"
 *   ielts-5.0-800.csv        → "5.0"
 *   toefl-100-1500.csv       → "100"
 *   real-conversation-시사.csv → "시사"
 */
export function inferLevelFromFilename(filename: string): string | null {
  const stem = filename.replace(/\.csv$/i, "");
  const lower = stem.toLowerCase();

  const batchMatch = lower.match(/_batch(\d+)$/);
  if (batchMatch) return `batch-${batchMatch[1]}`;

  // ielts-5.0-800 / ielts-7.0-1500
  const ieltsMatch = lower.match(/^ielts-(\d+(?:\.\d+)?)-/);
  if (ieltsMatch) return ieltsMatch[1] ?? null;

  // toefl-100-1500
  const toeflMatch = lower.match(/^toefl-(\d+)-/);
  if (toeflMatch) return toeflMatch[1] ?? null;

  // toeic-990-1500
  const toeicMatch = lower.match(/^toeic-(\d+)-/);
  if (toeicMatch) return toeicMatch[1] ?? null;

  // real-conversation-{label} — preserve original casing for the label
  const convMatch = stem.match(/^real-conversation-(.+)$/);
  if (convMatch) return convMatch[1] ?? null;

  return null;
}
