import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { SetupRequired } from "@/components/setup-required";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/supabase/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!getSupabaseEnv()) {
    return <SetupRequired />;
  }

  const user = await getSessionUser();
  if (user) {
    redirect("/tasks");
  }

  const params = await searchParams;
  const notice =
    params.error === "confirmation"
      ? "The confirmation link could not be completed. Try signing in."
      : null;

  return <AuthForm mode="login" notice={notice} />;
}
