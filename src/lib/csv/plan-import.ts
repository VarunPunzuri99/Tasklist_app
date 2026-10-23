import { parse } from "csv-parse/sync";

import { CSV_REASONS } from "@/lib/csv/reasons";
import { isStrictIsoDate } from "@/lib/tasks/dates";
import { MAX_CSV_BYTES, MAX_CSV_DATA_ROWS, MAX_TITLE_LENGTH, REQUIRED_CSV_HEADERS } from "@/lib/tasks/limits";
import { taskDuplicateKey, trimTaskText } from "@/lib/tasks/normalize";

export class CsvImportError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CsvImportError";
    this.status = status;
  }
}

export type AcceptedCsvTask = {
  rowNumber: number;
  title: string;
  notes: string | null;
  dueDate: string;
  priority: number;
};

export type RejectedCsvRow = {
  rowNumber: number;
  reason: string;
  title: string;
  dueDate: string;
  priority: string;
  notes: string;
};

export type CsvImportPlan = {
  accepted: AcceptedCsvTask[];
  rejected: RejectedCsvRow[];
  dataRowCount: number;
};

type ParsedRecord = {
  record: string[];
  info: { lines: number };
};

/**
 * rowNumber is the 1-based physical line where the CSV record ends.
 * For a normal one-line record this is the spreadsheet row, including the header.
 * A quoted field that spans lines uses the last physical line of that record.
 */
export function planCsvImport(content: string, existingKeys: ReadonlySet<string>): CsvImportPlan {
  if (Buffer.byteLength(content, "utf8") > MAX_CSV_BYTES) {
    throw new CsvImportError(`The CSV file exceeds the ${MAX_CSV_BYTES} byte limit.`, 413);
  }

  if (content.trim().length === 0) {
    throw new CsvImportError("The CSV file is empty.");
  }

  const records = parseRecords(content);
  if (records.length === 0) {
    throw new CsvImportError("The CSV file is empty.");
  }

  const header = records[0]?.record ?? [];
  validateHeaders(header);
  const indexes = headerIndexes(header.map((cell) => cell.trim()));
  const dataRecords = records.slice(1);

  if (dataRecords.length > MAX_CSV_DATA_ROWS) {
    throw new CsvImportError(`The CSV file exceeds the limit of ${MAX_CSV_DATA_ROWS} data rows.`, 413);
  }

  const accepted: AcceptedCsvTask[] = [];
  const rejected: RejectedCsvRow[] = [];
  const seen = new Set<string>();

  for (const entry of dataRecords) {
    const cells = entry.record;
    const rowNumber = entry.info.lines;
    const title = cell(cells, indexes.title);
    const dueDate = cell(cells, indexes.due_date);
    const priority = cell(cells, indexes.priority);
    const notes = cell(cells, indexes.notes);

    if (cells.every((value) => trimTaskText(value) === "")) {
      rejected.push({ rowNumber, reason: CSV_REASONS.blank, title, dueDate, priority, notes });
      continue;
    }

    if (cells.length > header.length) {
      rejected.push({
        rowNumber,
        reason: CSV_REASONS.columnCount,
        title,
        dueDate,
        priority,
        notes,
      });
      continue;
    }

    const reason = validateDataRow(title, dueDate, priority);
    if (reason) {
      rejected.push({ rowNumber, reason, title, dueDate, priority, notes });
      continue;
    }

    const trimmedTitle = trimTaskText(title);
    const normalizedDueDate = trimTaskText(dueDate);
    const key = taskDuplicateKey(trimmedTitle, normalizedDueDate);

    if (existingKeys.has(key)) {
      rejected.push({
        rowNumber,
        reason: CSV_REASONS.duplicateAccount,
        title,
        dueDate,
        priority,
        notes,
      });
      continue;
    }

    if (seen.has(key)) {
      rejected.push({
        rowNumber,
        reason: CSV_REASONS.duplicateCsv,
        title,
        dueDate,
        priority,
        notes,
      });
      continue;
    }

    seen.add(key);
    const trimmedNotes = trimTaskText(notes);
    accepted.push({
      rowNumber,
      title: trimmedTitle,
      notes: trimmedNotes.length === 0 ? null : trimmedNotes,
      dueDate: normalizedDueDate,
      priority: Number(trimTaskText(priority)),
    });
  }

  return { accepted, rejected, dataRowCount: dataRecords.length };
}

export function existingTaskKey(title: string, dueDate: string): string {
  return taskDuplicateKey(title, dueDate.slice(0, 10));
}

function parseRecords(content: string): ParsedRecord[] {
  try {
    return parse(content, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
      info: true,
    }) as unknown as ParsedRecord[];
  } catch {
    throw new CsvImportError(
      "The CSV file is malformed and could not be parsed. Check quotation marks and field boundaries.",
    );
  }
}

function validateHeaders(header: string[]): void {
  const names = header.map((cell) => cell.trim());
  const expected = new Set<string>(REQUIRED_CSV_HEADERS);
  const counts = new Map<string, number>();

  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const missing = REQUIRED_CSV_HEADERS.filter((name) => !counts.has(name));
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name || "(empty)");
  const unexpected = [...new Set(names.filter((name) => name !== "" && !expected.has(name)))];
  const problems: string[] = [];

  if (missing.length > 0) {
    problems.push(`Missing required column: ${missing.join(", ")}.`);
  }
  if (duplicates.length > 0) {
    problems.push(`Duplicate column: ${duplicates.join(", ")}.`);
  }
  if (unexpected.length > 0) {
    problems.push(`Unexpected column: ${unexpected.join(", ")}.`);
  }
  if (names.some((name) => name === "")) {
    problems.push("The header row contains an empty column name.");
  }

  if (problems.length > 0) {
    throw new CsvImportError(
      `The CSV header row is invalid. Expected title,due_date,priority,notes. ${problems.join(" ")}`,
    );
  }
}

function headerIndexes(names: string[]): Record<(typeof REQUIRED_CSV_HEADERS)[number], number> {
  return {
    title: names.indexOf("title"),
    due_date: names.indexOf("due_date"),
    priority: names.indexOf("priority"),
    notes: names.indexOf("notes"),
  };
}

function cell(cells: string[], index: number): string {
  return cells[index] ?? "";
}

function validateDataRow(title: string, dueDate: string, priority: string): string | null {
  const trimmedTitle = trimTaskText(title);
  if (trimmedTitle.length === 0) {
    return CSV_REASONS.titleRequired;
  }
  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    return CSV_REASONS.titleLength;
  }
  if (!isStrictIsoDate(trimTaskText(dueDate))) {
    return CSV_REASONS.dueDate;
  }
  if (!/^[1-5]$/.test(trimTaskText(priority))) {
    return CSV_REASONS.priority;
  }
  return null;
}
