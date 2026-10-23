import { mkdirSync, writeFileSync } from "node:fs";

const longTitle = "A".repeat(201);
const lines = [
  "title,due_date,priority,notes",
  "Submit timesheet,2026-11-02,2,Weekly hours",
  'Review payroll,2026-11-03,3,"Review payroll, then notify the manager"',
  "Submit timesheet,2026-11-02,2,Duplicate of the first task",
  "",
  "Board slides,2026-11-05,high,Deck",
  `${longTitle},2026-11-06,1,Too long`,
  "Impossible day,2026-02-30,2,Bad date",
  "Existing roadmap review,2026-10-01,1,Already in the account",
  'Quote check,2026-11-07,4,"She said ""ship it"""',
  "Submit timesheet,2026-12-01,2,Different day",
  "Submit expenses,2026-11-02,2,Different title",
  "submit timesheet,2026-12-01,1,Case duplicate",
  "   ,2026-11-08,1,Whitespace title",
];

const csv = `${lines.join("\r\n")}\r\n`;
mkdirSync("tests/fixtures", { recursive: true });
mkdirSync("public/samples", { recursive: true });
writeFileSync("tests/fixtures/import-edge-cases.csv", csv);
writeFileSync("public/samples/import-edge-cases.csv", csv);
writeFileSync(
  "tests/fixtures/account-duplicate.csv",
  ["title,due_date,priority,notes", "Existing roadmap review,2026-10-01,4,Second file", ""].join("\r\n"),
);
console.log("Wrote CSV fixtures.");
