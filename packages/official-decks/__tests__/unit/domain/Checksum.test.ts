import { describe, it, expect } from "vitest";
import { Checksum } from "@/domain/value-objects/Checksum";

describe("Checksum", () => {
  it("computes a stable SHA-256 hex string", () => {
    const a = Checksum.ofString("hello world");
    const b = Checksum.ofString("hello world");
    expect(a.value).toBe(b.value);
    expect(a.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different input → different checksum", () => {
    const a = Checksum.ofString("hello");
    const b = Checksum.ofString("world");
    expect(a.value).not.toBe(b.value);
  });

  it("canonicalises rows: order-independent, trimmed, blank rows skipped", () => {
    const rows1 = [
      { col: ["b", "x"] },
      { col: ["a", "y"] },
      { col: ["", ""] }, // blank
    ];
    const rows2 = [
      { col: ["a", "y"] },
      { col: ["b", "x"] },
    ];
    const c1 = Checksum.ofCanonicalRows(rows1);
    const c2 = Checksum.ofCanonicalRows(rows2);
    expect(c1.value).toBe(c2.value);
  });

  it("changing a single cell changes the checksum", () => {
    const a = Checksum.ofCanonicalRows([{ col: ["foo", "bar"] }]);
    const b = Checksum.ofCanonicalRows([{ col: ["foo", "baz"] }]);
    expect(a.value).not.toBe(b.value);
  });

  it("equals() is value-based", () => {
    const a = Checksum.ofString("x");
    const b = Checksum.ofString("x");
    const c = Checksum.ofString("y");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
