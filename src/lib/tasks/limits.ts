export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 5000;
export const MAX_CSV_BYTES = 1_048_576;
export const MAX_CSV_DATA_ROWS = 1000;
export const REQUIRED_CSV_HEADERS = ["title", "due_date", "priority", "notes"] as const;
