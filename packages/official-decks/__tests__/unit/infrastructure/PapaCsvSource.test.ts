import { describe, it, expect } from "vitest";
import { PapaCsvSource } from "@/infrastructure/csv/PapaCsvSource";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function withTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "papa-csv-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("PapaCsvSource.parse", () => {
  it("schema A (no header) → 16 columns, header=null", () => {
    const source = new PapaCsvSource({ directory: "/tmp" });
    const content = "scarf,She wore a warm scarf in winter.,스카프,그녀는 겨울에 따뜻한 스카프를 했어요.,マフラー,彼女は冬に暖かいマフラーをした。,围巾,她冬天围了一条暖和的围巾。,bufanda,Ella usó una bufanda cálida en invierno.,khăn quàng cổ,Cô ấy quàng khăn ấm vào mùa đông.,ผ้าพันคอ,เธอสวมผ้าพันคออุ่น ๆ ในฤดูหนาว,syal,Dia memakai syal hangat di musim dingin.\n";
    const result = source.parse("beginner_batch1.csv", content);
    expect(result.header).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.cells).toHaveLength(16);
    expect(result.rows[0]!.cells[0]).toBe("scarf");
  });

  it("schema B (with header) → header detected, first row removed", () => {
    const source = new PapaCsvSource({ directory: "/tmp" });
    const content =
      "english,example,ko_meaning,ko_example,ja_meaning,ja_example,zh_meaning,zh_example,es_meaning,es_example,vi_meaning,vi_example,th_meaning,th_example,id_meaning,id_example\n" +
      "hello,\"Hello, how are you today?\",안녕,안녕,こんにちは,こんにちは,你好,你好,hola,hola,xin chào,xin chào,สวัสดี,สวัสดี,halo,halo\n";
    const result = source.parse("english-beginner-1000.csv", content);
    expect(result.header).not.toBeNull();
    expect(result.header![0]).toBe("english");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.cells[0]).toBe("hello");
  });

  it("schema C (Korean source) → header detected with korean,english", () => {
    const source = new PapaCsvSource({ directory: "/tmp" });
    const content =
      "korean,english,alt,situation,note,category\n" +
      "요즘 물가가 미쳤어,Prices are insane these days.,Everything's so pricey now.,물가,note,시사\n";
    const result = source.parse("real-conversation-시사.csv", content);
    expect(result.header).not.toBeNull();
    expect(result.header![0]).toBe("korean");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.cells[0]).toBe("요즘 물가가 미쳤어");
  });

  it("strips UTF-8 BOM", () => {
    const source = new PapaCsvSource({ directory: "/tmp" });
    const content = "﻿english,example\nhello,world\n";
    const result = source.parse("x.csv", content);
    expect(result.header![0]).toBe("english");
  });

  it("skips empty lines", () => {
    const source = new PapaCsvSource({ directory: "/tmp" });
    const content =
      "english,example\n\nhello,world\n\n\nfoo,bar\n";
    const result = source.parse("x.csv", content);
    expect(result.rows).toHaveLength(2);
  });

  it("list() returns only .csv files, excluding chinese-pronunciation.csv and sidecars", async () => {
    const { dir, cleanup } = withTempDir();
    try {
      writeFileSync(join(dir, "beginner_batch1.csv"), "a,b,c");
      writeFileSync(join(dir, "ielts-5.0-800.csv"), "x");
      writeFileSync(join(dir, "chinese-pronunciation.csv"), "skip");
      writeFileSync(join(dir, "real-conversation-시사.csv.checkpoint"), "skip");
      writeFileSync(join(dir, "translate_daily.py"), "skip");

      const source = new PapaCsvSource({ directory: dir });
      const list = await source.list();
      expect(list).toContain("beginner_batch1.csv");
      expect(list).toContain("ielts-5.0-800.csv");
      expect(list).not.toContain("chinese-pronunciation.csv");
      expect(list).not.toContain("real-conversation-시사.csv.checkpoint");
      expect(list).not.toContain("translate_daily.py");
    } finally {
      cleanup();
    }
  });

  it("read() pulls a real file end-to-end", async () => {
    const { dir, cleanup } = withTempDir();
    try {
      writeFileSync(
        join(dir, "tiny.csv"),
        "english,example,ko_meaning,ko_example,ja_meaning,ja_example,zh_meaning,zh_example,es_meaning,es_example,vi_meaning,vi_example,th_meaning,th_example,id_meaning,id_example\nhello,hello world,안녕,안녕,こんにちは,こんにちは,你好,你好,hola,hola,xin chào,xin chào,สวัสดี,สวัสดี,halo,halo\n",
      );
      const source = new PapaCsvSource({ directory: dir });
      const csv = await source.read("tiny.csv");
      expect(csv.filename).toBe("tiny.csv");
      expect(csv.header![0]).toBe("english");
      expect(csv.rows[0]!.cells[0]).toBe("hello");
    } finally {
      cleanup();
    }
  });
});
