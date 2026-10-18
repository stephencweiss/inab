export type MoneyFailure = "invalid-money" | "unsafe-cents" | "zero-transaction";
export type MoneyResult = { ok: true; value: number } | { ok: false; reason: MoneyFailure };
export type AmountUse = "opening" | "snapshot" | "transaction";

export function parseMoney(input: unknown): MoneyResult {
  if (typeof input !== "string" || !/^-?\d+(?:\.\d{1,2})?$/.test(input)) {
    return { ok: false, reason: "invalid-money" };
  }
  const negative = input.startsWith("-");
  const unsigned = negative ? input.slice(1) : input;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const magnitude = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  const cents = negative ? -magnitude : magnitude;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    return { ok: false, reason: "unsafe-cents" };
  }
  return { ok: true, value: Number(cents) };
}

export function validateCents(cents: number, use: AmountUse): MoneyResult {
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: "unsafe-cents" };
  if (use === "transaction" && cents === 0) return { ok: false, reason: "zero-transaction" };
  return { ok: true, value: cents };
}

/** Rejects an unsafe intermediate total even if later amounts would cancel it. */
export function checkedSum(amounts: readonly number[]): MoneyResult {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) {
      return { ok: false, reason: "unsafe-cents" };
    }
    total += amount;
  }
  return { ok: true, value: total };
}
