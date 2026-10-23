import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { jsonError, jsonOk } from "@/lib/http";
import { utcIsoDate } from "@/lib/tasks/dates";
import { logDatabaseError, taskWriteFailure } from "@/lib/tasks/db-errors";
import { cleanCreate, fieldErrorMap, taskCreateSchema, taskListQuerySchema } from "@/lib/tasks/schema";
import { toTask, type TaskCounts, type TaskRow } from "@/lib/tasks/types";

async function requireSupabase(): Promise<
  | { ok: false; response: ReturnType<typeof jsonError> }
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
> {
  if (!getSupabaseEnv()) {
    return { ok: false, response: jsonError(500, "Server is missing Supabase configuration.") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) {
    return { ok: false, response: jsonError(401, "Authentication required.") };
  }

  return { ok: true, supabase, userId: data.claims.sub };
}

export async function GET(request: Request) {
  const context = await requireSupabase();
  if (!context.ok) {
    return context.response;
  }

  const url = new URL(request.url);
  const parsed = taskListQuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    priority: url.searchParams.get("priority") ?? undefined,
    due: url.searchParams.get("due") ?? undefined,
    today: url.searchParams.get("today") ?? undefined,
  });

  if (!parsed.success) {
    return jsonError(400, "The filters are invalid.", { fieldErrors: fieldErrorMap(parsed.error) });
  }

  const today = parsed.data.today ?? utcIsoDate();
  const status = !parsed.data.status || parsed.data.status === "all" ? null : parsed.data.status;
  const priority =
    !parsed.data.priority || parsed.data.priority === "all" ? null : Number(parsed.data.priority);
  const due = !parsed.data.due || parsed.data.due === "all" ? null : parsed.data.due;

  const { data, error } = await context.supabase.rpc("list_my_tasks", {
    p_query: parsed.data.q || null,
    p_status: status,
    p_priority: priority,
    p_due: due,
    p_today: today,
  });

  if (error) {
    logDatabaseError("tasks.list", error);
    const missing = error.code === "PGRST202" || /could not find the function/i.test(error.message);
    return jsonError(
      500,
      missing
        ? "The database migration has not been applied."
        : "Tasks could not be loaded.",
    );
  }

  const rows = (data ?? []) as TaskRow[];
  const tasks = rows.map(toTask).sort(compareTasks);

  const { data: summaryRows, error: summaryError } = await context.supabase
    .from("tasks")
    .select("status, due_date")
    .is("deleted_at", null);

  if (summaryError) {
    logDatabaseError("tasks.counts", summaryError);
    return jsonError(500, "Tasks could not be loaded.");
  }

  const summary = summaryRows ?? [];
  const counts: TaskCounts = {
    total: summary.length,
    pending: summary.filter((row) => row.status === "pending").length,
    completed: summary.filter((row) => row.status === "completed").length,
    overdue: summary.filter(
      (row) => row.status === "pending" && String(row.due_date).slice(0, 10) < today,
    ).length,
    showing: tasks.length,
  };

  return jsonOk({ tasks, counts });
}

export async function POST(request: Request) {
  const context = await requireSupabase();
  if (!context.ok) {
    return context.response;
  }

  const body = await readJson(request);
  if (body === null) {
    return jsonError(400, "The request body must be JSON.");
  }

  const record = isRecord(body) ? { ...body, notes: typeof body.notes === "string" ? body.notes : "" } : body;
  const parsed = taskCreateSchema.safeParse(record);
  if (!parsed.success) {
    return jsonError(400, "The task could not be created.", {
      fieldErrors: fieldErrorMap(parsed.error),
    });
  }

  const task = cleanCreate(parsed.data);
  const { data, error } = await context.supabase
    .from("tasks")
    .insert({
      user_id: context.userId,
      title: task.title,
      notes: task.notes,
      due_date: task.dueDate,
      priority: task.priority,
      status: "pending",
    })
    .select("id, title, notes, due_date, priority, status, created_at, updated_at")
    .single();

  if (error) {
    logDatabaseError("tasks.create", error);
    const failure = taskWriteFailure(
      error,
      "An active task with this title and due date already exists.",
    );
    return jsonError(failure.status, failure.message);
  }

  return jsonOk({ task: toTask(data as TaskRow) }, 201);
}

function compareTasks(
  left: { dueDate: string; createdAt: string; id: string },
  right: { dueDate: string; createdAt: string; id: string },
): number {
  return (
    left.dueDate.localeCompare(right.dueDate) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
