const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date written as YYYY-MM-DD. */
export function isStrictIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function utcIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function localIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
