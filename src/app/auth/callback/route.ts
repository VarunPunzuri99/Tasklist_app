import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/tasks";
  const destination = new URL(next.startsWith("/") ? next : "/tasks", url.origin);

  if (!getSupabaseEnv()) {
    destination.pathname = "/login";
    destination.searchParams.set("error", "configuration");
    return NextResponse.redirect(destination);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      destination.pathname = "/login";
      destination.searchParams.set("error", "confirmation");
      return NextResponse.redirect(destination);
    }
  }

  return NextResponse.redirect(destination);
}
