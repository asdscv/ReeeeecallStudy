#!/usr/bin/env node
import { PapaCsvSource } from "@/infrastructure/csv/PapaCsvSource";
import {
  buildPlansForCsv,
  buildAllPlans,
} from "@/application/services/ImportPlanBuilder";
import { ExecuteImportUseCase } from "@/application/use-cases/ExecuteImportUseCase";
import { SupabaseDeckImportGateway } from "@/infrastructure/persistence/SupabaseDeckImportGateway";
import { PgDeckImportGateway } from "@/infrastructure/persistence/PgDeckImportGateway";
import {
  createServiceRoleClient,
  readServiceRoleConfigFromEnv,
} from "@/infrastructure/auth/ServiceRoleClient";
import type { ImportPlan } from "@/application/dto/ImportPlan";
import type { DeckImportGateway } from "@/application/ports/DeckImportGateway";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ParsedArgs {
  command: string;
  options: Map<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!;
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq > 0) {
        options.set(t.slice(2, eq), t.slice(eq + 1));
      } else {
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          options.set(t.slice(2), next);
          i++;
        } else {
          flags.add(t.slice(2));
        }
      }
    }
  }
  return { command, options, flags };
}

function printHelp(): void {
  console.log(
    [
      "official-decks <command> [--options]",
      "",
      "commands:",
      "  plan      Read CSVs and print the import plan summary (no DB writes).",
      "  apply     Read CSVs and apply the plan against Supabase.",
      "  status    Read manifest from DB and print status of every deck.",
      "  validate  Cross-check DB manifest checksums against CSV state.",
      "",
      "options:",
      "  --dir <path>            CSV directory (default: ./STUDY_DATA or $STUDY_DATA_DIR)",
      "  --filter <substr>       Only process CSVs whose filename includes the substring",
      "  --target <code>         Limit to one target language (en/ko/ja/zh/es/vi/th/id)",
      "  --concurrency <n>       Parallel RPC calls during apply (default: 4)",
      "  --skip-malformed        Skip malformed rows instead of aborting (default: true)",
      "  --json                  Emit machine-readable JSON instead of human text",
    ].join("\n"),
  );
}

async function loadAllPlans(args: ParsedArgs): Promise<readonly ImportPlan[]> {
  const dir =
    args.options.get("dir") ?? process.env.STUDY_DATA_DIR ?? "./STUDY_DATA";
  const filter = args.options.get("filter") ?? "";
  const target = args.options.get("target") ?? "";
  const skipMalformed =
    args.options.get("skip-malformed") !== "false" &&
    !args.flags.has("no-skip-malformed");

  const source = new PapaCsvSource({ directory: dir });
  const allFiles = await source.list();
  const filtered = filter
    ? allFiles.filter((f) => f.includes(filter))
    : allFiles;

  const plans: ImportPlan[] = [];
  for (const filename of filtered) {
    const csv = await source.read(filename);
    const filePlans = buildPlansForCsv(csv, {
      skipMalformedRows: skipMalformed,
      onWarning: () => {}, // suppress per-row warnings in CLI mode
    });
    for (const plan of filePlans) {
      if (target && plan.deck.languagePair.target !== target) continue;
      plans.push(plan);
    }
  }
  return plans;
}

async function runPlan(args: ParsedArgs): Promise<void> {
  const plans = await loadAllPlans(args);
  if (args.flags.has("json")) {
    const out = plans.map((p) => ({
      manifest_key: p.deck.manifestKey.toString(),
      deck_id: p.deck.id,
      name: p.deck.name,
      source: p.deck.languagePair.source,
      target: p.deck.languagePair.target,
      category: p.deck.category,
      card_count: p.deck.cards.length,
      checksum: p.checksum,
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`# Import Plan — ${plans.length} decks`);
  const byCategory = new Map<string, number>();
  for (const p of plans) {
    byCategory.set(p.deck.category, (byCategory.get(p.deck.category) ?? 0) + 1);
  }
  for (const [cat, n] of [...byCategory.entries()].sort()) {
    console.log(`  ${cat.padEnd(15)} ${n} decks`);
  }
  const totalCards = plans.reduce((a, p) => a + p.deck.cards.length, 0);
  console.log(`\n  total cards: ${totalCards}`);
  console.log(`\nFirst 5 plans:`);
  for (const p of plans.slice(0, 5)) {
    console.log(
      `  - [${p.deck.languagePair.toString()}] ${p.deck.name} (${p.deck.cards.length} cards)`,
    );
  }
}

interface GatewayBundle {
  gateway: DeckImportGateway;
  cleanup?: () => Promise<void>;
  supabaseClient?: SupabaseClient;
}

async function makeGateway(): Promise<GatewayBundle> {
  // Prefer PG_URL when set (direct postgres — used by integration tests and
  // by local dev when Supabase isn't running).
  if (process.env.PG_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.PG_URL });
    await client.connect();
    return {
      gateway: new PgDeckImportGateway(client),
      cleanup: () => client.end(),
    };
  }
  const cfg = readServiceRoleConfigFromEnv();
  const supabaseClient = createServiceRoleClient(cfg);
  return {
    gateway: new SupabaseDeckImportGateway(supabaseClient),
    supabaseClient,
  };
}

async function runApply(args: ParsedArgs): Promise<void> {
  const plans = await loadAllPlans(args);
  const bundle = await makeGateway();
  const useCase = new ExecuteImportUseCase(bundle.gateway);

  const concurrency = Number(args.options.get("concurrency") ?? 4);
  const total = plans.length;
  const report = await useCase.execute(plans, {
    concurrency,
    onProgress: (summary, done) => {
      const status = summary.status.padEnd(8);
      const key = summary.manifestKey.padEnd(50);
      const cards = `${summary.cardCount.toString().padStart(5)} cards`;
      const ms = `${summary.durationMs.toString().padStart(6)}ms`;
      const line = `[${done.toString().padStart(3)}/${total}] ${status} ${key} ${cards} ${ms}`;
      if (summary.error) {
        process.stderr.write(line + `  ⛔ ${summary.error}\n`);
      } else {
        process.stdout.write(line + "\n");
      }
    },
  });

  if (bundle.cleanup) {
    await bundle.cleanup();
  }
  if (args.flags.has("json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("");
  console.log(`applied: ${report.applied}`);
  console.log(`noop:    ${report.noop}`);
  console.log(`failed:  ${report.failed}`);
  console.log(`total:   ${report.totalPlans}`);
  console.log(
    `time:    ${Date.parse(report.finishedAt) - Date.parse(report.startedAt)} ms`,
  );
  if (report.failed > 0) {
    process.exitCode = 1;
    return;
  }
}

interface ManifestRow {
  manifest_key: string;
  last_status: string;
  card_count: number;
  last_applied_at: string;
  last_applied_checksum: string | null;
}

async function fetchManifest(): Promise<ManifestRow[]> {
  if (process.env.PG_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.PG_URL });
    await client.connect();
    try {
      const { rows } = await client.query<ManifestRow>(
        `SELECT * FROM get_official_deck_manifest()`,
      );
      return rows;
    } finally {
      await client.end();
    }
  }
  const cfg = readServiceRoleConfigFromEnv();
  const client = createServiceRoleClient(cfg);
  const { data, error } = await client.rpc("get_official_deck_manifest");
  if (error) {
    throw new Error(`get_official_deck_manifest failed: ${error.message}`);
  }
  return (data as ManifestRow[]) ?? [];
}

async function runStatus(args: ParsedArgs): Promise<void> {
  const rows = await fetchManifest();
  if (args.flags.has("json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(`# Manifest (${rows.length} rows)`);
  for (const r of rows) {
    console.log(
      `  [${r.last_status.padEnd(8)}] ${r.manifest_key.padEnd(60)} ${r.card_count.toString().padStart(5)} cards @ ${r.last_applied_at}`,
    );
  }
}

async function runValidate(args: ParsedArgs): Promise<void> {
  const plans = await loadAllPlans(args);
  const rows = await fetchManifest();

  const dbByKey = new Map<string, { checksum: string | null; status: string }>();
  for (const row of rows) {
    dbByKey.set(row.manifest_key, {
      checksum: row.last_applied_checksum,
      status: row.last_status,
    });
  }

  let drift = 0;
  let missing = 0;
  let inDbOnly = 0;
  const csvKeys = new Set<string>();
  for (const plan of plans) {
    const key = plan.deck.manifestKey.toString();
    csvKeys.add(key);
    const db = dbByKey.get(key);
    if (!db) {
      missing++;
      console.log(`MISSING:   ${key}`);
      continue;
    }
    if (db.checksum !== plan.checksum) {
      drift++;
      console.log(`DRIFT:     ${key}  db=${db.checksum?.slice(0, 12)} csv=${plan.checksum.slice(0, 12)}`);
    }
  }
  for (const key of dbByKey.keys()) {
    if (!csvKeys.has(key)) {
      inDbOnly++;
      console.log(`ORPHAN:    ${key}`);
    }
  }
  console.log("");
  console.log(`Total CSV plans : ${plans.length}`);
  console.log(`Total DB rows   : ${dbByKey.size}`);
  console.log(`Drift           : ${drift}`);
  console.log(`Missing in DB   : ${missing}`);
  console.log(`Orphan in DB    : ${inDbOnly}`);
  if (drift > 0 || missing > 0 || inDbOnly > 0) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "plan":
      return runPlan(args);
    case "apply":
      return runApply(args);
    case "status":
      return runStatus(args);
    case "validate":
      return runValidate(args);
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      console.error(`unknown command: ${args.command}`);
      printHelp();
      process.exitCode = 64;
  }
}

main().catch((e: Error) => {
  console.error(`fatal: ${e.message}`);
  process.exitCode = 1;
});

// expose internal `buildAllPlans` for advanced scripting against the CLI module
export { buildAllPlans };
