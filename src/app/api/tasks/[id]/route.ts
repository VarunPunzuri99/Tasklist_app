import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { jsonError, jsonOk } from "@/lib/http";
import { logDatabaseError, taskWriteFailure } from "@/lib/tasks/db-errors";
import { cleanPatch, fieldErrorMap, taskPatchSchema } from "@/lib/tasks/schema";
import { toTask, type TaskRow } from "@/lib/tasks/types";

const TASK_COLUMNS = "id, title, notes, due_date, priority, status, created_at, updated_at";

async function requireSupabase(): Promise<
  | { ok: false; response: ReturnType<typeof jsonError> }
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  if (!getSupabaseEnv()) {
    return { ok: false, response: jsonError(500, "Server is missing Supabase configuration.") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) {
    return { ok: false, response: jsonError(401, "Authentication required.") };
  }

  return { ok: true, supabase };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSupabase();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(404, "Task not found.");
  }

  const body = await readJson(request);
  if (!isRecord(body)) {
    return jsonError(400, "The request body must be JSON.");
  }

  const parsed = taskPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "The task could not be updated.", {
      fieldErrors: fieldErrorMap(parsed.error),
    });
  }

  const cleaned = cleanPatch(parsed.data);
  const update: {
    title?: string;
    notes?: string | null;
    due_date?: string;
    priority?: number;
    status?: "pending" | "completed";
  } = {};

  if (cleaned.title !== undefined) {
    update.title = cleaned.title;
  }
  if (cleaned.notes !== undefined) {
    update.notes = cleaned.notes;
  }
  if (cleaned.dueDate !== undefined) {
    update.due_date = cleaned.dueDate;
  }
  if (cleaned.priority !== undefined) {
    update.priority = cleaned.priority;
  }
  if (cleaned.status !== undefined) {
    update.status = cleaned.status;
  }

  const { data, error } = await auth.supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .is("deleted_at", null)
    .select(TASK_COLUMNS)
    .maybeSingle();

  if (error) {
    logDatabaseError("tasks.update", error);
    const failure = taskWriteFailure(
      error,
      "An active task with this title and due date already exists.",
    );
    return jsonError(failure.status, failure.message);
  }

  if (!data) {
    return jsonError(404, "Task not found.");
  }

  return jsonOk({ task: toTask(data as TaskRow) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSupabase();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return jsonError(404, "Task not found.");
  }

  const { data, error } = await auth.supabase
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    logDatabaseError("tasks.delete", error);
    return jsonError(500, "The task could not be deleted.");
  }

  if (!data) {
    return jsonError(404, "Task not found.");
  }

  return jsonOk({ deleted: true });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
