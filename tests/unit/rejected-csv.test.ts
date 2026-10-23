import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";

import { buildRejectedCsv } from "@/lib/csv/rejected-csv";

describe("rejected CSV download", () => {
  it("escapes commas, quotes, and newlines", () => {
    const csv = buildRejectedCsv([
      {
        rowNumber: 4,
        reason: 'Say "no", then stop',
        title: "A, B",
        dueDate: "2026-11-01",
        priority: "high",
        notes: "Line one\nLine two",
      },
    ]);

    const [row] = parse(csv, { columns: true, bom: true }) as Array<Record<string, string>>;
    expect(row).toEqual({
      row_number: "4",
      reason: 'Say "no", then stop',
      title: "A, B",
      due_date: "2026-11-01",
      priority: "high",
      notes: "Line one\nLine two",
    });
  });
});
