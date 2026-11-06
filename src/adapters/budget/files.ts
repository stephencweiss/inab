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
