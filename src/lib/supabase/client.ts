import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createBrowserClient(env.url, env.key);
}
