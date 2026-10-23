import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CsvImportError, planCsvImport } from "@/lib/csv/plan-import";
import { CSV_REASONS } from "@/lib/csv/reasons";
import { taskDuplicateKey } from "@/lib/tasks/normalize";

const headers = "title,due_date,priority,notes";

function plan(csv: string, existing: string[] = []) {
  return planCsvImport(csv, new Set(existing));
}

describe("CSV validation", () => {
  it("accepts a valid row", () => {
    const result = plan(`${headers}\nShip report,2026-11-02,3,Notes`);
    expect(result.accepted).toEqual([
      expect.objectContaining({ title: "Ship report", dueDate: "2026-11-02", priority: 3, notes: "Notes" }),
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("rejects a missing title and a whitespace-only title", () => {
    const result = plan(`${headers}\n,2026-11-02,3,Missing\n   ,2026-11-03,3,Spaces`);
    expect(result.rejected.map((row) => row.reason)).toEqual([
      CSV_REASONS.titleRequired,
      CSV_REASONS.titleRequired,
    ]);
  });

  it("accepts a 200 character title and rejects a longer one", () => {
    const exact = "B".repeat(200);
    const longer = "C".repeat(201);
    const result = plan(`${headers}\n${exact},2026-11-02,1,\n${longer},2026-11-03,1,`);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.title).toHaveLength(200);
    expect(result.rejected[0]?.reason).toBe(CSV_REASONS.titleLength);
  });

  it("accepts a leap day and rejects dates that are not real calendar dates", () => {
    const result = plan(
      [
        headers,
        "Leap,2024-02-29,1,",
        "Century,2000-02-29,1,",
        "Not leap,2026-02-29,1,",
        "Non century,1900-02-29,1,",
        "Impossible,2026-02-30,1,",
        "Month,2026-13-01,1,",
        "Format,02/30/2026,1,",
        "Empty,,1,",
      ].join("\n"),
    );
    expect(result.accepted.map((row) => row.dueDate)).toEqual(["2024-02-29", "2000-02-29"]);
    expect(result.rejected.every((row) => row.reason === CSV_REASONS.dueDate)).toBe(true);
  });

  it("accepts priorities 1 and 5 and rejects 0, 6, words, and decimals", () => {
    const result = plan(
      [headers, "Low,2026-11-01,1,", "High,2026-11-02,5,", "Zero,2026-11-03,0,", "Six,2026-11-04,6,", "Word,2026-11-05,high,", "Decimal,2026-11-06,1.5,"].join(
        "\n",
      ),
    );
    expect(result.accepted.map((row) => row.priority)).toEqual([1, 5]);
    expect(result.rejected.every((row) => row.reason === CSV_REASONS.priority)).toBe(true);
  });

  it("rejects missing, duplicate, and unexpected headers", () => {
    expect(() => plan("title,due_date,priority\nA,2026-11-01,1")).toThrow(CsvImportError);
    expect(() => plan("title,title,due_date,priority,notes\nA,A,2026-11-01,1,")).toThrow(/Duplicate column/);
    expect(() => plan("title,due_date,priority,notes,owner\nA,2026-11-01,1,n,me")).toThrow(/Unexpected column/);
  });

  it("keeps a quoted comma in notes and parses Windows line endings", () => {
    const csv = `${headers}\r\nReview,2026-11-03,3,"Review payroll, then notify the manager"\r\n`;
    const result = plan(csv);
    expect(result.accepted[0]?.notes).toBe("Review payroll, then notify the manager");
    expect(result.accepted[0]?.rowNumber).toBe(2);
  });

  it("rejects a blank row without stopping the next valid row", () => {
    const result = plan(`${headers}\nValid,2026-11-01,2,Keep\n\nAfter,2026-11-04,4,Also`);
    expect(result.accepted.map((row) => row.title)).toEqual(["Valid", "After"]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: CSV_REASONS.blank, rowNumber: 3 }),
    ]);
  });

  it("returns a safe error for malformed quotes", () => {
    expect(() => plan(`${headers}\nBroken,2026-11-01,1,"unterminated`)).toThrow(
      /malformed and could not be parsed/,
    );
  });

  it("uses spreadsheet row numbers for the edge-case fixture", () => {
    const csv = readFileSync(path.join(process.cwd(), "tests/fixtures/import-edge-cases.csv"), "utf8");
    expect(csv).toContain("\r\n");
    const existing = taskDuplicateKey("Existing roadmap review", "2026-10-01");
    const result = plan(csv, [existing]);

    expect(result.accepted.map((row) => [row.rowNumber, row.title, row.dueDate])).toEqual([
      [2, "Submit timesheet", "2026-11-02"],
      [3, "Review payroll", "2026-11-03"],
      [10, "Quote check", "2026-11-07"],
      [11, "Submit timesheet", "2026-12-01"],
      [12, "Submit expenses", "2026-11-02"],
    ]);
    expect(result.accepted[1]?.notes).toBe("Review payroll, then notify the manager");
    expect(result.accepted[2]?.notes).toBe('She said "ship it"');

    expect(result.rejected.map((row) => [row.rowNumber, row.reason])).toEqual([
      [4, CSV_REASONS.duplicateCsv],
      [5, CSV_REASONS.blank],
      [6, CSV_REASONS.priority],
      [7, CSV_REASONS.titleLength],
      [8, CSV_REASONS.dueDate],
      [9, CSV_REASONS.duplicateAccount],
      [13, CSV_REASONS.duplicateCsv],
      [14, CSV_REASONS.titleRequired],
    ]);
  });
});
