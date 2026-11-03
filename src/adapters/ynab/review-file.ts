import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseReviewEnvelope } from "../../accounts/imports/parse-review.js";
import type { ReviewEnvelope } from "../../accounts/imports/types.js";
import { assertOutsideCheckout, readBoundedFile } from "./files.js";
export function readReview(path: string): ReviewEnvelope {
  const file = readBoundedFile(path);
  try {
    return parseReviewEnvelope(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)),
    );
  } catch {
    throw new Error("invalid-review");
  }
}
function destination(path: string): string {
  const absolute = resolve(path);
  let parent = dirname(absolute);
  while (!existsSync(parent)) parent = dirname(parent);
  assertOutsideCheckout(join(realpathSync(parent), absolute.slice(parent.length)));
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  const canonical = join(realpathSync(dirname(absolute)), basename(absolute));
  assertOutsideCheckout(canonical);
  if (existsSync(canonical) && lstatSync(canonical).isSymbolicLink())
    throw new Error("invalid-path");
  return canonical;
}
function assertNoAlias(path: string, forbiddenPaths: string[]): void {
  for (const forbidden of forbiddenPaths) {
    if (resolve(forbidden) === path) throw new Error("review-alias");
    if (!existsSync(forbidden)) continue;
    if (realpathSync(forbidden) === path) throw new Error("review-alias");
    if (!existsSync(path)) continue;
    const left = statSync(path, { bigint: true });
    const right = statSync(forbidden, { bigint: true });
    if (left.dev === right.dev && left.ino === right.ino) throw new Error("review-alias");
  }
}
function writePrivate(path: string, envelope: ReviewEnvelope): void {
  const text = JSON.stringify(parseReviewEnvelope(envelope));
  if (Buffer.byteLength(text) > 64 * 1024 * 1024) throw new Error("input-limit");
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, text);
    fsyncSync(descriptor);
  } catch (error) {
    unlinkSync(path);
    throw error;
  } finally {
    closeSync(descriptor);
  }
}
export function createReview(
  path: string,
  envelope: ReviewEnvelope,
  forbiddenPaths: string[],
): void {
  const target = destination(path);
  assertNoAlias(target, [
    ...forbiddenPaths,
    envelope.target.path,
    envelope.sources.register.path,
    envelope.sources.plan.path,
  ]);
  writePrivate(target, envelope);
}
/** Holds an exclusive lock until asynchronous work settles. Existing locks are never stolen. */
export async function withReviewLock<T>(path: string, work: () => Promise<T> | T): Promise<T> {
  const target = destination(path);
  const lock = `${target}.lock`;
  let descriptor: number;
  try {
    descriptor = openSync(lock, "wx", 0o600);
  } catch {
    throw new Error("review-locked");
  }
  const owned = fstatSync(descriptor, { bigint: true });
  try {
    return await work();
  } finally {
    closeSync(descriptor);
    if (existsSync(lock)) {
      const current = lstatSync(lock, { bigint: true });
      if (current.dev === owned.dev && current.ino === owned.ino) unlinkSync(lock);
    }
  }
}
/** Caller must hold the review lock. Replacement is atomic on the destination filesystem. */
export function writeReview(path: string, envelope: ReviewEnvelope): void {
  const target = destination(path);
  assertNoAlias(target, [
    envelope.target.path,
    envelope.sources.register.path,
    envelope.sources.plan.path,
  ]);
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    writePrivate(temporary, envelope);
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
export async function updateReview(
  path: string,
  expectedRevision: number,
  mutate: (review: ReviewEnvelope) => ReviewEnvelope,
): Promise<ReviewEnvelope> {
  return withReviewLock(path, () => {
    const current = readReview(path);
    if (current.revision !== expectedRevision) throw new Error("stale-review");
    const next = parseReviewEnvelope(mutate(current));
    if (next.revision !== current.revision + 1) throw new Error("invalid-review");
    writeReview(path, next);
    return next;
  });
}
