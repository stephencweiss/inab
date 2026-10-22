import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CsvRow, RecordResult, SourceRole } from "../../accounts/imports/source-types.js";
import type { LoadedFile, LoadedSources } from "../../accounts/imports/types.js";
import { parseYnabCsv } from "./csv.js";
import { parsePlanRecord, parseRegisterRecord } from "./values.js";
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export function assertOutsideCheckout(path: string): void {
  const distance = relative(checkout, path);
  if (
    distance === "" ||
    (!distance.startsWith(`..${sep}`) && distance !== ".." && !distance.startsWith(sep))
  )
    throw new Error("private-path-in-checkout");
}
/** Bound descriptor size before allocation; read and hash the same bytes. Symlink endpoints are refused. */
export function readBoundedFile(path: string): { path: string; bytes: Uint8Array } {
  if (lstatSync(path).isSymbolicLink()) throw new Error("invalid-path");
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("invalid-path");
    if (before.size > 64n * 1024n * 1024n) throw new Error("input-limit");
    const canonical = realpathSync(path);
    assertOutsideCheckout(canonical);
    const endpoint = statSync(canonical, { bigint: true });
    if (endpoint.dev !== before.dev || endpoint.ino !== before.ino)
      throw new Error("changed-source");
    const bytes = new Uint8Array(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) throw new Error("changed-source");
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error("changed-source");
    return { path: canonical, bytes };
  } finally {
    closeSync(descriptor);
  }
}
function loadSource<T>(
  role: SourceRole,
  path: string,
  parseRecord: (row: CsvRow, headers: string[]) => RecordResult<T>,
): LoadedFile<T> {
  const source = readBoundedFile(path);
  const sha256 = createHash("sha256").update(source.bytes).digest("hex");
  const csv = parseYnabCsv(role, source.bytes);
  if (!csv.ok) throw new Error(csv.reason);
  const rows = csv.value.rows.map((row) => {
    const result = parseRecord(row, csv.value.headers);
    return {
      key: `${role}:${sha256}:${row.ordinal}`,
      ordinal: row.ordinal,
      raw: row.raw,
      original: Object.fromEntries(
        csv.value.headers.map((header, index) => [header, row.fields[index] ?? ""]),
      ),
      value: result.ok ? result.value : null,
      error: result.ok ? null : result.reason,
    };
  });
  return { ...source, sha256, rows };
}
export function readSources(registerPath: string, planPath: string): LoadedSources {
  const register = loadSource("register", registerPath, parseRegisterRecord);
  const plan = loadSource("plan", planPath, parsePlanRecord);
  const left = statSync(register.path, { bigint: true });
  const right = statSync(plan.path, { bigint: true });
  if (left.dev === right.dev && left.ino === right.ino) throw new Error("source-alias");
  return { register, plan };
}
