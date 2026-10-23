import { redirect } from "next/navigation";

import { SetupRequired } from "@/components/setup-required";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/supabase/session";

export default async function HomePage() {
  if (!getSupabaseEnv()) {
    return <SetupRequired />;
  }

  const user = await getSessionUser();
  redirect(user ? "/tasks" : "/login");
}
