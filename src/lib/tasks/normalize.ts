const EDGE_WHITESPACE = /^[\t\n\r\f\v ]+|[\t\n\r\f\v ]+$/g;

/** Removes the same edge whitespace as public.normalize_task_title. */
export function trimTaskText(value: string): string {
  return value.replace(EDGE_WHITESPACE, "");
}

/**
 * Duplicate key for a title. ASCII A-Z is lowercased to match
 * PostgreSQL lower(value COLLATE "C"). Other characters are unchanged.
 */
export function normalizeTaskTitle(value: string): string {
  return trimTaskText(value).replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32),
  );
}

export function taskDuplicateKey(title: string, dueDate: string): string {
  return `${normalizeTaskTitle(title)}\u0000${dueDate}`;
}
