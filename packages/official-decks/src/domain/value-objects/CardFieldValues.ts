// Discriminated union representing the two card payload shapes used by
// official decks. The `kind` field is what we serialise; downstream consumers
// (RPC, UI) read it to choose a layout.

export interface WordCardFieldValues {
  readonly kind: "word";
  readonly front: string;
  readonly back: string;
  readonly example_front: string;
  readonly example_back: string;
}

export interface PhraseCardFieldValues {
  readonly kind: "phrase";
  readonly front: string;
  readonly back: string;
  readonly alt: string;
  readonly situation: string;
  readonly note: string;
}

export type CardFieldValues = WordCardFieldValues | PhraseCardFieldValues;

export function isWordCard(v: CardFieldValues): v is WordCardFieldValues {
  return v.kind === "word";
}

export function isPhraseCard(v: CardFieldValues): v is PhraseCardFieldValues {
  return v.kind === "phrase";
}
