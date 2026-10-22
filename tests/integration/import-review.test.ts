import { expect, it } from "vitest";
import { createMigration } from "../../src/application/imports.js";
import type { ImportFiles, ImportStore } from "../../src/application/import-ports.js";
import type { ReviewEnvelope } from "../../src/accounts/imports/types.js";

it("rejects a stale target before it can create review state", () => {
  const target = {
    id: "target",
    path: "/example/db",
    schemaVersion: 4,
    setupRevision: 1,
    fileIdentity: { device: "1", inode: "1" },
  };
  const fail = (): never => {
    throw new Error("unexpected-file-write");
  };
  const files: ImportFiles = {
    readSources: fail,
    readReview: fail,
    createReview: fail,
    writeReview: fail,
    updateReview: async () => fail(),
    withReviewLock: async (_p, work) => work(),
  };
  const store: ImportStore = {
    target: () => target,
    eligible: () => {
      throw new Error("setup-closed");
    },
    receipt: () => null,
    commit: async () => fail(),
  };
  const app = createMigration(files, store, {
    id: () => "id",
    now: () => "2026-10-22T00:00:00.000Z",
    today: () => "2026-10-22",
  });
  expect(() =>
    app.preview({
      registerPath: "/example/r",
      planPath: "/example/p",
      reviewPath: "/example/review",
    }),
  ).toThrow("setup-closed");
});
it("does not accept a different review revision for confirmation", async () => {
  const review: ReviewEnvelope = {
    version: 1,
    reviewId: "id",
    revision: 2,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    target: {
      id: "target",
      path: "/example/db",
      schemaVersion: 4,
      setupRevision: 1,
      fileIdentity: { device: "1", inode: "1" },
    },
    sources: {
      register: { path: "/example/r", sha256: "a".repeat(64), byteLength: 0 },
      plan: { path: "/example/p", sha256: "b".repeat(64), byteLength: 0 },
    },
    decisions: [],
  };
  const fail = (): never => {
    throw new Error("unexpected-write");
  };
  const files: ImportFiles = {
    readSources: fail,
    readReview: () => review,
    createReview: fail,
    writeReview: fail,
    updateReview: async () => fail(),
    withReviewLock: async (_p, work) => work(),
  };
  const store: ImportStore = {
    target: () => review.target,
    eligible: fail,
    receipt: () => null,
    commit: async () => fail(),
  };
  const app = createMigration(files, store, {
    id: () => "id",
    now: () => "2026-10-22T00:00:00.000Z",
    today: () => "2026-10-22",
  });
  await expect(app.commit("/example/review", 1)).rejects.toThrow("stale-review");
});
it("reports the operation ID when confirmation has an unexpected storage failure", async () => {
  const target = {
    id: "target",
    path: "/example/db",
    schemaVersion: 4,
    setupRevision: 1,
    fileIdentity: { device: "1", inode: "1" },
  };
  const sources = {
    register: { path: "/example/r", sha256: "a".repeat(64), bytes: new Uint8Array(), rows: [] },
    plan: { path: "/example/p", sha256: "b".repeat(64), bytes: new Uint8Array(), rows: [] },
  };
  const review: ReviewEnvelope = {
    version: 1,
    reviewId: "operation-123",
    revision: 1,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    target,
    sources: {
      register: { path: sources.register.path, sha256: sources.register.sha256, byteLength: 0 },
      plan: { path: sources.plan.path, sha256: sources.plan.sha256, byteLength: 0 },
    },
    decisions: [],
  };
  const noWrite = (): never => {
    throw new Error("unexpected review write");
  };
  const files: ImportFiles = {
    readSources: () => sources,
    readReview: () => review,
    createReview: noWrite,
    writeReview: noWrite,
    updateReview: async () => noWrite(),
    withReviewLock: async (_p, work) => work(),
  };
  const store: ImportStore = {
    target: () => target,
    eligible: () => {},
    receipt: () => null,
    commit: async () => {
      throw new Error("Synthetic write failure");
    },
  };
  const app = createMigration(files, store, {
    id: () => "id",
    now: () => "2026-10-22T00:00:00.000Z",
    today: () => "2026-10-22",
  });
  await expect(app.commit("/example/review", 1)).rejects.toMatchObject({
    operationId: "operation-123",
  });
});
it("keeps replaced observation evidence and clears its previous resolution", async () => {
  const target = {
    id: "target",
    path: "/example/db",
    schemaVersion: 4,
    setupRevision: 1,
    fileIdentity: { device: "1", inode: "1" },
  };
  const sources = {
    register: { path: "/example/r", sha256: "a".repeat(64), bytes: new Uint8Array(), rows: [] },
    plan: { path: "/example/p", sha256: "b".repeat(64), bytes: new Uint8Array(), rows: [] },
  };
  let saved: ReviewEnvelope = {
    version: 1,
    reviewId: "id",
    revision: 1,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    target,
    sources: {
      register: { path: sources.register.path, sha256: sources.register.sha256, byteLength: 0 },
      plan: { path: sources.plan.path, sha256: sources.plan.sha256, byteLength: 0 },
    },
    decisions: [
      {
        tag: "observation",
        key: "old",
        accountKey: "account:1",
        rowKey: "row-a",
        date: "2026-10-20",
        cents: 12500,
      },
      { tag: "resolve", key: "old", choice: "revise-adjustment" },
    ],
  };
  const fail = (): never => {
    throw new Error("unexpected write");
  };
  const files: ImportFiles = {
    readSources: () => sources,
    readReview: () => saved,
    createReview: fail,
    writeReview: fail,
    updateReview: async (_path, _rev, change) => {
      saved = change(saved);
      return saved;
    },
    withReviewLock: async (_p, work) => work(),
  };
  const store: ImportStore = {
    target: () => target,
    eligible: () => {},
    receipt: () => null,
    commit: async () => fail(),
  };
  const app = createMigration(files, store, {
    id: () => "new",
    now: () => "2026-10-22T00:00:00.000Z",
    today: () => "2026-10-22",
  });
  await app.change("/example/review", 1, {
    tag: "observation",
    accountKey: "account:1",
    rowKey: "row-b",
    date: "2026-10-20",
    cents: 13000,
  });
  expect(saved.decisions).toContainEqual({
    tag: "observation-audit",
    key: "old",
    accountKey: "account:1",
    rowKey: "row-a",
    date: "2026-10-20",
    cents: 12500,
    resolution: "revise-adjustment",
  });
  expect(saved.decisions.some((d) => d.tag === "resolve" && d.key === "old")).toBe(false);
});
