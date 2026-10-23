import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { planCsvImport } from "@/lib/csv/plan-import";
import { CSV_REASONS } from "@/lib/csv/reasons";
import { normalizeTaskTitle, taskDuplicateKey } from "@/lib/tasks/normalize";

const headers = "title,due_date,priority,notes";

describe("duplicate handling", () => {
  it("keeps the first matching row in the file and rejects the rest", () => {
    const result = planCsvImport(
      [headers, "Pay Rent,2026-11-01,2,First", "Pay Rent,2026-11-01,4,Second", "pay rent,2026-11-01,1,Third"].join("\n"),
      new Set(),
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.notes).toBe("First");
    expect(result.rejected.map((row) => row.reason)).toEqual([
      CSV_REASONS.duplicateCsv,
      CSV_REASONS.duplicateCsv,
    ]);
  });

  it("allows the same title on another date and another title on the same date", () => {
    const result = planCsvImport(
      [headers, "Pay Rent,2026-11-01,2,", "Pay Rent,2026-12-01,2,", "Pay Fees,2026-11-01,2,"].join("\n"),
      new Set(),
    );
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toEqual([]);
  });

  it("rejects an active account duplicate using the case-insensitive key", () => {
    const existing = new Set([taskDuplicateKey("  Pay Rent ", "2026-11-01")]);
    const result = planCsvImport(`${headers}\npay rent,2026-11-01,3,Again`, existing);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe(CSV_REASONS.duplicateAccount);
  });

  it("does not treat a missing soft-deleted key as an account duplicate", () => {
    const result = planCsvImport(`${headers}\nPay Rent,2026-11-01,3,Again`, new Set());
    expect(result.accepted).toHaveLength(1);
  });

  it("normalizes ASCII case and surrounding whitespace only", () => {
    expect(normalizeTaskTitle("  Pay Rent \t")).toBe("pay rent");
    expect(normalizeTaskTitle("Straße")).toBe("straße");
  });

  it("rejects the seeded account row in the second fixture", () => {
    const csv = readFileSync(path.join(process.cwd(), "tests/fixtures/account-duplicate.csv"), "utf8");
    const result = planCsvImport(csv, new Set([taskDuplicateKey("Existing roadmap review", "2026-10-01")]));
    expect(result.rejected[0]?.reason).toBe(CSV_REASONS.duplicateAccount);
    expect(result.accepted).toEqual([]);
  });
});
