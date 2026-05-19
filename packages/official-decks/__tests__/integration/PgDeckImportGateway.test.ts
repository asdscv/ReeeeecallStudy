/**
 * Integration tests against a postgres container with all migrations applied.
 *
 *   Required env:
 *     PG_URL = postgres://postgres:postgres@127.0.0.1:55433/postgres
 *
 *   The local dev environment uses `docker run -p 55433:5432 postgres:15`
 *   plus `.github/scripts/bootstrap-auth.sql` + all migrations in order.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { PgDeckImportGateway } from "@/infrastructure/persistence/PgDeckImportGateway";
import { buildPlansForCsv } from "@/application/services/ImportPlanBuilder";
import type { RawCsv } from "@/application/ports/CsvSource";

const PG_URL =
  process.env.PG_URL ?? "postgres://postgres:postgres@127.0.0.1:55433/postgres";

function makeRawCsv(filename: string, n: number, seed = ""): RawCsv {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      cells: [
        `word${i}${seed}`,
        `Example ${i}.`,
        `한글${i}${seed}`,
        `예시 ${i}.`,
        `日本語${i}`,
        `例文${i}.`,
        `中文${i}`,
        `例句${i}.`,
        `palabra${i}`,
        `Ejemplo ${i}.`,
        `tiếng${i}`,
        `Ví dụ ${i}.`,
        `ภาษา${i}`,
        `ตัวอย่าง${i}.`,
        `kata${i}`,
        `Contoh ${i}.`,
      ],
    });
  }
  return { filename, header: null, rows };
}

// Top-level probe so `describe.skipIf` is resolved at module load time.
// Without this, vitest collects the suite before beforeAll runs and the
// `it.skipIf(!client)` predicate is always falsy.
const isReachable = await (async () => {
  const c = new Client({ connectionString: PG_URL });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!isReachable)("PgDeckImportGateway — integration", () => {
  let client: Client;
  let gateway: PgDeckImportGateway;

  beforeAll(async () => {
    client = new Client({ connectionString: PG_URL });
    await client.connect();
    gateway = new PgDeckImportGateway(client);
    // Clean any decks left over from prior test runs. We identify test decks
    // by manifest_key prefix `csv:integ_pg_` — that's stable regardless of the
    // generated deck name (which depends on the inferred category).
    await client.query(
      `DELETE FROM decks WHERE id IN (
         SELECT deck_id FROM official_deck_manifest WHERE manifest_key LIKE 'csv:integ_pg_%'
       )`,
    );
    await client.query(
      `DELETE FROM official_deck_manifest WHERE manifest_key LIKE 'csv:integ_pg_%'`,
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query(
        `DELETE FROM decks WHERE id IN (
           SELECT deck_id FROM official_deck_manifest WHERE manifest_key LIKE 'csv:integ_pg_%'
         )`,
      );
      await client.query(
        `DELETE FROM official_deck_manifest WHERE manifest_key LIKE 'csv:integ_pg_%'`,
      );
      await client.end();
    }
  });

  it("seeded system user, templates, and settings exist", async () => {
    const { rows: u } = await client!.query(
      `SELECT id, is_official FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'`,
    );
    expect(u[0].is_official).toBe(true);

    const { rows: t } = await client!.query(
      `SELECT id FROM card_templates WHERE id IN ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222')`,
    );
    expect(t).toHaveLength(2);

    const { rows: s } = await client!.query(
      `SELECT max_listings, display_badge FROM official_account_settings WHERE user_id = '00000000-0000-0000-0000-000000000001'`,
    );
    expect(s[0].max_listings).toBe(1000);
    expect(s[0].display_badge).toBe("official");
  });

  it("first apply: inserts deck + cards + listing + manifest", async () => {
    const plan = buildPlansForCsv(makeRawCsv("integ_pg_first.csv", 3)).find(
      (p) => p.deck.languagePair.target === "ko",
    )!;

    const s = await gateway.apply(plan);
    expect(s.status).toBe("applied");
    expect(s.cardsInserted).toBe(3);
    expect(s.cardsUpdated).toBe(0);
    expect(s.cardsDeleted).toBe(0);

    const { rows: cards } = await client!.query(
      `SELECT COUNT(*)::int AS n FROM cards WHERE deck_id = $1`,
      [plan.deck.id],
    );
    expect(cards[0].n).toBe(3);

    const { rows: listing } = await client!.query(
      `SELECT card_count, share_mode, is_active FROM marketplace_listings WHERE deck_id = $1`,
      [plan.deck.id],
    );
    expect(listing[0].card_count).toBe(3);
    expect(listing[0].share_mode).toBe("subscribe");
    expect(listing[0].is_active).toBe(true);

    const { rows: mr } = await client!.query(
      `SELECT card_count, last_status, last_applied_checksum FROM official_deck_manifest WHERE manifest_key = $1`,
      [plan.deck.manifestKey.toString()],
    );
    expect(mr[0].card_count).toBe(3);
    expect(mr[0].last_status).toBe("applied");
    expect(mr[0].last_applied_checksum).toBe(plan.checksum);
  });

  it("second apply with same payload: noop", async () => {
    const plan = buildPlansForCsv(makeRawCsv("integ_pg_noop.csv", 2)).find(
      (p) => p.deck.languagePair.target === "ja",
    )!;
    const first = await gateway.apply(plan);
    expect(first.status).toBe("applied");
    const second = await gateway.apply(plan);
    expect(second.status).toBe("noop");
    expect(second.cardsInserted).toBe(0);
    expect(second.cardsUpdated).toBe(0);
    expect(second.cardsDeleted).toBe(0);
  });

  it("removing CSV rows deletes only those cards", async () => {
    const fullPlan = buildPlansForCsv(makeRawCsv("integ_pg_diff.csv", 4)).find(
      (p) => p.deck.languagePair.target === "zh",
    )!;
    await gateway.apply(fullPlan);

    const shrunkPlan = buildPlansForCsv(makeRawCsv("integ_pg_diff.csv", 2)).find(
      (p) => p.deck.languagePair.target === "zh",
    )!;
    const after = await gateway.apply(shrunkPlan);
    expect(after.status).toBe("applied");
    expect(after.cardsDeleted).toBe(2);
    expect(after.cardsInserted).toBe(0);
    expect(after.cardsUpdated).toBe(0);
  });

  it(
    "JS computeDeckId matches PostgreSQL uuid_generate_v5",
    async () => {
      const plan = buildPlansForCsv(makeRawCsv("integ_pg_parity.csv", 1)).find(
        (p) => p.deck.languagePair.target === "es",
      )!;
      const { rows } = await client!.query(
        `SELECT uuid_generate_v5(
           '6f7d8a9b-3c4e-4d6f-8a8b-9c0d1e2f3a4b'::UUID,
           $1
         )::TEXT AS sql_id`,
        [plan.deck.manifestKey.toString()],
      );
      expect(rows[0].sql_id).toBe(plan.deck.id);
    },
  );

  it(
    "modifying a row updates only the affected card",
    async () => {
      const csv1 = makeRawCsv("integ_pg_edit.csv", 3);
      const plan1 = buildPlansForCsv(csv1).find(
        (p) => p.deck.languagePair.target === "vi",
      )!;
      await gateway.apply(plan1);

      // Change index 1's korean column (not relevant for vi target, but
      // its presence in the canonical row is included in the checksum,
      // so checksum changes → re-apply triggered).
      const csv2: RawCsv = {
        filename: "integ_pg_edit.csv",
        header: null,
        rows: csv1.rows.map((r, i) =>
          i === 1
            ? { cells: r.cells.map((c, ci) => (ci === 10 ? "tiếng_수정" : c)) }
            : r,
        ),
      };
      const plan2 = buildPlansForCsv(csv2).find(
        (p) => p.deck.languagePair.target === "vi",
      )!;
      const s2 = await gateway.apply(plan2);
      expect(s2.status).toBe("applied");
      // Exactly one card's vi column changed
      expect(s2.cardsUpdated).toBe(1);
      expect(s2.cardsInserted).toBe(0);
      expect(s2.cardsDeleted).toBe(0);
    },
  );

  it(
    "validation: source_language must differ from target_language",
    async () => {
      await expect(
        client!.query(
          `SELECT import_official_deck($1, $2, $3::jsonb, $4::jsonb)`,
          [
            "csv:integ_pg_bad:en-en",
            "xxx",
            JSON.stringify({
              name: "Bad",
              source_file: "x.csv",
              source_language: "en",
              target_language: "en",
              category: "beginner",
              template_id: "11111111-1111-1111-1111-111111111111",
              tags: [],
            }),
            "[]",
          ],
        ),
      ).rejects.toThrow(/must differ/i);
    },
  );

  it(
    "validation: missing template_id throws",
    async () => {
      await expect(
        client!.query(
          `SELECT import_official_deck($1, $2, $3::jsonb, $4::jsonb)`,
          [
            "csv:integ_pg_notpl:en-ko",
            "yyy",
            JSON.stringify({
              name: "X",
              source_file: "x.csv",
              source_language: "en",
              target_language: "ko",
              category: "beginner",
              tags: [],
            }),
            "[]",
          ],
        ),
      ).rejects.toThrow(/template_id/i);
    },
  );

  it(
    "get_official_deck_manifest returns applied rows",
    async () => {
      const { rows } = await client!.query(
        `SELECT * FROM get_official_deck_manifest()`,
      );
      expect(Array.isArray(rows)).toBe(true);
      // At least the test decks created above should be present
      expect(rows.length).toBeGreaterThan(0);
    },
  );
});
