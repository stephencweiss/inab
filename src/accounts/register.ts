import type { RegisterEntry } from "./types.js";

/** Use this order for register totals and display so intermediate safe-range checks agree. */
export function orderRegisterEntries<T extends RegisterEntry & { createdAt: string }>(
  entries: T[],
) {
  return entries.toSorted(
    (a, b) =>
      a.occurredOn.localeCompare(b.occurredOn) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
