export const CSV_REASONS = {
  blank: "Blank row",
  titleRequired: "Title is required.",
  titleLength: "Title must be 200 characters or fewer.",
  dueDate: "Due date must be a real calendar date in YYYY-MM-DD format.",
  priority: "Priority must be a whole number from 1 to 5.",
  columnCount: "Row has an unexpected number of columns.",
  duplicateCsv: "Duplicate title and due date in CSV",
  duplicateAccount: "Task already exists in account",
} as const;
