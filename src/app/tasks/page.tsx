import { redirect } from "next/navigation";

import { SetupRequired } from "@/components/setup-required";
import { TaskDashboard } from "@/components/task-dashboard";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSessionUser } from "@/lib/supabase/session";

export default async function TasksPage() {
  if (!getSupabaseEnv()) {
    return <SetupRequired />;
  }

  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <TaskDashboard email={user.email ?? "Signed in"} />;
}
