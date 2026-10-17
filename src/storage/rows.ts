export function parseInteger(value: unknown): number {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result)) {
    throw new Error("Invalid database integer");
  }
  return result;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseMigrationRow(value: unknown) {
  if (!isRecord(value) || typeof value.hash !== "string") {
    throw new Error("Invalid migration history");
  }
  return { hash: value.hash, createdAt: parseInteger(value.created_at) };
}
