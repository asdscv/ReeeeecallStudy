import type { LanguagePair } from "@/domain/value-objects/LanguagePair";

export class ManifestKey {
  private constructor(public readonly value: string) {}

  static of(filename: string, pair: LanguagePair): ManifestKey {
    if (!filename || filename.length === 0) {
      throw new Error("filename required");
    }
    if (filename.includes("/") || filename.includes("\\") || filename.startsWith("..")) {
      throw new Error(`filename must be a basename, not a path: ${filename}`);
    }
    const lower = filename.toLowerCase();
    if (!lower.endsWith(".csv")) {
      throw new Error(`filename is not a csv: ${filename}`);
    }
    const stem = filename.slice(0, filename.length - ".csv".length);
    if (stem.length === 0) {
      throw new Error("filename stem empty");
    }
    return new ManifestKey(`csv:${stem}:${pair.toString()}`);
  }

  toString(): string {
    return this.value;
  }

  equals(other: ManifestKey): boolean {
    return this.value === other.value;
  }
}
