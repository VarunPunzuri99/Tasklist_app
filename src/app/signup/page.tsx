import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { SetupRequired } from "@/components/setup-required";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/supabase/session";

export default async function SignupPage() {
  if (!getSupabaseEnv()) {
    return <SetupRequired />;
  }

  const user = await getSessionUser();
  if (user) {
    redirect("/tasks");
  }

  return <AuthForm mode="signup" />;
}
