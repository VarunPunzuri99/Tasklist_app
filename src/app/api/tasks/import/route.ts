import { buildRejectedCsv } from "@/lib/csv/rejected-csv";
import { CsvImportError, existingTaskKey, planCsvImport } from "@/lib/csv/plan-import";
import { jsonError, jsonOk } from "@/lib/http";
import { importFailure, logDatabaseError } from "@/lib/tasks/db-errors";
import { MAX_CSV_BYTES } from "@/lib/tasks/limits";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const importResultSchema = z.object({
  inserted_count: z.number().int().nonnegative(),
  inserted_ids: z.array(z.string()),
});

export async function POST(request: Request) {
  if (!getSupabaseEnv()) {
    return jsonError(500, "Server is missing Supabase configuration.");
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims.sub) {
    return jsonError(401, "Authentication required.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Upload a CSV file.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "Choose a CSV file to import.");
  }

  const filename = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const typeAllowed =
    type === "" ||
    type === "text/csv" ||
    type === "application/csv" ||
    type === "application/vnd.ms-excel" ||
    type === "text/plain";

  if (!filename.endsWith(".csv") || !typeAllowed) {
    return jsonError(415, "Upload a .csv file.");
  }

  if (file.size > MAX_CSV_BYTES) {
    return jsonError(413, `The CSV file exceeds the ${MAX_CSV_BYTES} byte limit.`);
  }

  const content = await file.text();

  let plan;
  try {
    const { data: existing, error: existingError } = await supabase
      .from("tasks")
      .select("title, due_date")
      .is("deleted_at", null);

    if (existingError) {
      logDatabaseError("tasks.import.existing", existingError);
      return jsonError(500, "Existing tasks could not be checked. Nothing was imported.");
    }

    const keys = new Set<string>();
    for (const row of existing ?? []) {
      keys.add(existingTaskKey(String(row.title), String(row.due_date)));
    }

    plan = planCsvImport(content, keys);
  } catch (error) {
    if (error instanceof CsvImportError) {
      return jsonError(error.status, error.message);
    }
    console.error("[tasks.import] parse failed");
    return jsonError(400, "The CSV file could not be imported.");
  }

  const rejectedCsv = buildRejectedCsv(plan.rejected);

  if (plan.accepted.length === 0) {
    return jsonOk({
      importedCount: 0,
      rejectedCount: plan.rejected.length,
      insertedIds: [],
      rejected: plan.rejected,
      rejectedCsv,
      message:
        plan.dataRowCount === 0
          ? "No data rows were found."
          : "No rows were imported. Review the rejected rows.",
    });
  }

  const { data, error } = await supabase.rpc("import_tasks", {
    candidates: plan.accepted.map((row) => ({
      title: row.title,
      due_date: row.dueDate,
      priority: row.priority,
      notes: row.notes,
    })),
  });

  if (error) {
    logDatabaseError("tasks.import", error);
    const failure = importFailure(error);
    return jsonError(failure.status, failure.message, {
      importedCount: 0,
      rejectedCount: plan.rejected.length,
      insertedIds: [],
      rejected: plan.rejected,
      rejectedCsv,
    });
  }

  const parsed = importResultSchema.safeParse(data);
  if (!parsed.success || parsed.data.inserted_count !== plan.accepted.length) {
    console.error("[tasks.import] unexpected import result");
    return jsonError(500, "The import result did not match the accepted rows. Refresh the task list before trying again.", {
      importedCount: 0,
      rejectedCount: plan.rejected.length,
      insertedIds: [],
      rejected: plan.rejected,
      rejectedCsv,
    });
  }

  return jsonOk({
    importedCount: parsed.data.inserted_count,
    rejectedCount: plan.rejected.length,
    insertedIds: parsed.data.inserted_ids,
    rejected: plan.rejected,
    rejectedCsv,
    message: `${parsed.data.inserted_count} task${parsed.data.inserted_count === 1 ? "" : "s"} imported. ${plan.rejected.length} row${plan.rejected.length === 1 ? "" : "s"} rejected.`,
  });
}
