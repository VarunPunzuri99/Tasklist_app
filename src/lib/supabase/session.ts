import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type SessionUser = {
  id: string;
  email: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!getSupabaseEnv()) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) {
    return null;
  }

  const email = data.claims.email;
  return {
    id: data.claims.sub,
    email: typeof email === "string" ? email : null,
  };
}
