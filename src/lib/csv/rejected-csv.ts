import { stringify } from "csv-stringify/sync";

import type { RejectedCsvRow } from "@/lib/csv/plan-import";

export function buildRejectedCsv(rows: readonly RejectedCsvRow[]): string {
  return stringify(
    rows.map((row) => [row.rowNumber, row.reason, row.title, row.dueDate, row.priority, row.notes]),
    {
      header: true,
      columns: ["row_number", "reason", "title", "due_date", "priority", "notes"],
    },
  );
}
