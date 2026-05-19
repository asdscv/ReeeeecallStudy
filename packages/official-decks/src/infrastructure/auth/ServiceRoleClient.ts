import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ServiceRoleConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
}

export function readServiceRoleConfigFromEnv(): ServiceRoleConfig {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "SUPABASE_URL is required (e.g., http://127.0.0.1:54321 for local).",
    );
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required. Run `supabase status` to find it.",
    );
  }
  return { url, serviceRoleKey: key };
}

export function createServiceRoleClient(cfg: ServiceRoleConfig): SupabaseClient {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: { schema: "public" },
  });
}
