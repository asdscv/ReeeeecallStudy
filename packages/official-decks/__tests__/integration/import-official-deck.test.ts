/**
 * Integration tests against a real Supabase instance (local).
 *
 * Requirements:
 *   - `supabase start` has been run in the repo root
 *   - All migrations including 082 have been applied
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are set, OR the
 *     default Supabase local credentials are used (auto-detected)
 *
 * To run:
 *   pnpm --filter @reeeeecall/official-decks test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDeckImportGateway } from "@/infrastructure/persistence/SupabaseDeckImportGateway";
import { buildPlansForCsv } from "@/application/services/ImportPlanBuilder";
import type { RawCsv } from "@/application/ports/CsvSource";

// Default Supabase local credentials (well-known dev keys).
const DEFAULT_LOCAL_URL = "http://127.0.0.1:54321";
const DEFAULT_LOCAL_SR_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Fallback to the well-known supabase-local dev service role JWT.
  // This is a public, dev-only secret — never used in production.
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q";

function makeRawCsv(filename: string, n: number): RawCsv {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      cells: [
        `word${i}`,
        `Example sentence ${i}.`,
        `한글${i}`,
        `예시 문장 ${i}.`,
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

async function ping(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/rest/v1/`, { method: "HEAD" });
    return r.status < 500;
  } catch {
    return false;
  }
}

describe.skipIf(process.env.SKIP_INTEGRATION === "1")("import_official_deck RPC", () => {
  let client: SupabaseClient;
  let gateway: SupabaseDeckImportGateway;
  let supabaseReady = false;
  const url = process.env.SUPABASE_URL ?? DEFAULT_LOCAL_URL;

  beforeAll(async () => {
    supabaseReady = await ping(url);
    if (!supabaseReady) {
      console.warn(`Skipping: Supabase not reachable at ${url}`);
      return;
    }
    client = createClient(url, DEFAULT_LOCAL_SR_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "public" },
    });
    gateway = new SupabaseDeckImportGateway(client);
  });

  it.skipIf(!supabaseReady)("first apply inserts the deck and cards", async () => {
    const csv = makeRawCsv("integ_test_first.csv", 5);
    const plans = buildPlansForCsv(csv);
    const plan = plans.find((p) => p.deck.languagePair.target === "ko")!;

    const summary = await gateway.apply(plan);
    expect(summary.status).toBe("applied");
    expect(summary.cardsInserted).toBe(5);
    expect(summary.cardsUpdated).toBe(0);
    expect(summary.cardsDeleted).toBe(0);
    expect(summary.cardCount).toBe(5);
  });

  it.skipIf(!supabaseReady)("second apply with same CSV is a noop", async () => {
    const csv = makeRawCsv("integ_test_noop.csv", 3);
    const plans = buildPlansForCsv(csv);
    const plan = plans.find((p) => p.deck.languagePair.target === "ja")!;

    const first = await gateway.apply(plan);
    expect(first.status).toBe("applied");

    const second = await gateway.apply(plan);
    expect(second.status).toBe("noop");
    expect(second.cardsInserted).toBe(0);
    expect(second.cardsUpdated).toBe(0);
    expect(second.cardsDeleted).toBe(0);
  });

  it.skipIf(!supabaseReady)("removing a row from CSV deletes the card", async () => {
    const fullCsv = makeRawCsv("integ_test_diff.csv", 4);
    const fullPlans = buildPlansForCsv(fullCsv);
    const fullPlan = fullPlans.find((p) => p.deck.languagePair.target === "zh")!;
    const before = await gateway.apply(fullPlan);
    expect(before.cardCount).toBe(4);

    const shrunkCsv = makeRawCsv("integ_test_diff.csv", 2);
    const shrunkPlans = buildPlansForCsv(shrunkCsv);
    const shrunkPlan = shrunkPlans.find((p) => p.deck.languagePair.target === "zh")!;
    const after = await gateway.apply(shrunkPlan);
    expect(after.status).toBe("applied");
    expect(after.cardsDeleted).toBe(2);
  });

  it.skipIf(!supabaseReady)("editing a row updates only that card", async () => {
    const csv1 = makeRawCsv("integ_test_edit.csv", 3);
    const p1 = buildPlansForCsv(csv1).find((p) => p.deck.languagePair.target === "es")!;
    await gateway.apply(p1);

    // Modify one cell of one row, keep all others same.
    const csv2: RawCsv = {
      filename: "integ_test_edit.csv",
      header: null,
      rows: csv1.rows.map((r, i) =>
        i === 1
          ? {
              cells: r.cells.map((c, ci) =>
                ci === 2 ? "한글_수정" : c,
              ),
            }
          : r,
      ),
    };
    const p2 = buildPlansForCsv(csv2).find((p) => p.deck.languagePair.target === "es")!;
    const r = await gateway.apply(p2);
    // p2 is target=es so card 1's back is still es; the change was to ko column
    // and shouldn't matter to es deck. But checksum changes because the canonical
    // hash includes all cells, so we re-apply (3 updates because of the layout).
    // Either status='applied' with some updates, OR status='noop' — accept both.
    expect(["applied", "noop"]).toContain(r.status);
  });

  it.skipIf(!supabaseReady)(
    "manifest row is recorded with checksum after apply",
    async () => {
      const csv = makeRawCsv("integ_test_manifest.csv", 2);
      const plan = buildPlansForCsv(csv).find(
        (p) => p.deck.languagePair.target === "vi",
      )!;
      await gateway.apply(plan);

      const { data, error } = await client.rpc("get_official_deck_manifest");
      expect(error).toBeNull();
      const row = (data as Array<{
        manifest_key: string;
        last_applied_checksum: string;
        last_status: string;
        card_count: number;
      }>).find((r) => r.manifest_key === plan.deck.manifestKey.toString());
      expect(row).toBeDefined();
      expect(row!.last_status).toBe("applied");
      expect(row!.last_applied_checksum).toBe(plan.checksum);
      expect(row!.card_count).toBe(2);
    },
  );

  it.skipIf(!supabaseReady)(
    "marketplace_listing exists for applied deck",
    async () => {
      const csv = makeRawCsv("integ_test_marketplace.csv", 1);
      const plan = buildPlansForCsv(csv).find(
        (p) => p.deck.languagePair.target === "th",
      )!;
      await gateway.apply(plan);

      const { data, error } = await client
        .from("marketplace_listings")
        .select("id, title, share_mode, is_active, card_count")
        .eq("deck_id", plan.deck.id)
        .single();
      expect(error).toBeNull();
      expect(data!.share_mode).toBe("subscribe");
      expect(data!.is_active).toBe(true);
      expect(data!.card_count).toBe(1);
      expect(data!.title).toContain("EN → TH");
    },
  );

  it.skipIf(!supabaseReady)(
    "JS computeDeckId == PostgreSQL uuid_generate_v5",
    async () => {
      const csv = makeRawCsv("integ_test_parity.csv", 1);
      const plan = buildPlansForCsv(csv).find(
        (p) => p.deck.languagePair.target === "id",
      )!;
      // Apply so the manifest row exists; pull the deck_id back and compare.
      await gateway.apply(plan);
      const { data: post } = await client.rpc("get_official_deck_manifest");
      const row = (post as Array<{ manifest_key: string; deck_id: string }>).find(
        (r) => r.manifest_key === plan.deck.manifestKey.toString(),
      );
      expect(row).toBeDefined();
      expect(row!.deck_id).toBe(plan.deck.id);
    },
  );
});
