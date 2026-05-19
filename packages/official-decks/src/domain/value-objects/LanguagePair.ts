import {
  type LanguageCode,
  parseLanguageCode,
} from "@/domain/value-objects/LanguageCode";

export class LanguagePair {
  private constructor(
    public readonly source: LanguageCode,
    public readonly target: LanguageCode,
  ) {}

  static of(source: LanguageCode, target: LanguageCode): LanguagePair {
    if (source === target) {
      throw new Error(
        `LanguagePair source and target must differ (got ${source})`,
      );
    }
    return new LanguagePair(source, target);
  }

  static fromString(value: string): LanguagePair {
    const match = /^([a-z]{2})-([a-z]{2})$/.exec(value);
    if (!match) {
      throw new Error(`malformed language pair: ${JSON.stringify(value)}`);
    }
    const source = parseLanguageCode(match[1]!);
    const target = parseLanguageCode(match[2]!);
    return LanguagePair.of(source, target);
  }

  toString(): string {
    return `${this.source}-${this.target}`;
  }

  equals(other: LanguagePair): boolean {
    return this.source === other.source && this.target === other.target;
  }
}
