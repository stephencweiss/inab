export type DateResult = { ok: true; value: string } | { ok: false; reason: "invalid-date" };

/** A calendar date has no time or zone. Years are 0001 through 9999. */
export function parseDate(input: unknown): DateResult {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { ok: false, reason: "invalid-date" };
  }
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const limit = monthDays[month - 1] ?? 0;
  if (year === 0 || day < 1 || day > limit) return { ok: false, reason: "invalid-date" };
  return { ok: true, value: input };
}
