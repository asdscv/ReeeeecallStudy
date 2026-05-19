import type { CardFieldValues } from "@/domain/value-objects/CardFieldValues";

export interface OfficialCard {
  readonly id: string;
  readonly sortPosition: number;
  readonly fieldValues: CardFieldValues;
  readonly tags: readonly string[];
}
