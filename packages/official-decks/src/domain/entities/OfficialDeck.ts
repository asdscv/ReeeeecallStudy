import type { DeckCategory } from "@/domain/value-objects/DeckCategory";
import type { LanguagePair } from "@/domain/value-objects/LanguagePair";
import type { ManifestKey } from "@/domain/value-objects/ManifestKey";
import type { OfficialCard } from "@/domain/entities/OfficialCard";

export const WORD_TEMPLATE_ID = "11111111-1111-1111-1111-111111111111" as const;
export const PHRASE_TEMPLATE_ID = "22222222-2222-2222-2222-222222222222" as const;

export type CardTemplateId =
  | typeof WORD_TEMPLATE_ID
  | typeof PHRASE_TEMPLATE_ID;

export interface OfficialDeck {
  readonly id: string;
  readonly manifestKey: ManifestKey;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly icon: string;
  readonly category: DeckCategory;
  readonly tags: readonly string[];
  readonly languagePair: LanguagePair;
  readonly sourceFile: string;
  readonly templateId: CardTemplateId;
  readonly cards: readonly OfficialCard[];
}
