import { createImportReview, requireReviewSources, viewReview } from "./import-review.js";
import { ImportStorageError } from "./import-ports.js";
import type { ImportFiles, ImportStore, ImportRuntime } from "./import-ports.js";
export function createMigration(files: ImportFiles, store: ImportStore, runtime: ImportRuntime) {
  const review = createImportReview(files, store, runtime);
  async function commit(path: string, expected: number) {
    return files.withReviewLock(path, async () => {
      const envelope = files.readReview(path);
      if (envelope.revision !== expected) throw new Error("stale-review");
      const receipt = store.receipt(envelope);
      if (receipt !== null) return receipt;
      const sources = requireReviewSources(files, store, envelope);
      const view = viewReview(envelope, sources, runtime.today());
      if (!view.derived.ready) throw new Error("incomplete-review");
      try {
        return await store.commit(
          envelope,
          sources,
          view.derived,
          view.observations,
          runtime.now(),
        );
      } catch (error) {
        const expectedReasons = new Set([
          "setup-closed",
          "setup-not-empty",
          "stale-target",
          "stale-review",
          "source-changed",
          "changed-source",
          "incomplete-review",
          "unsafe-cents",
        ]);
        if (error instanceof Error && expectedReasons.has(error.message)) throw error;
        throw new ImportStorageError(envelope.reviewId, error instanceof Error ? error : {});
      }
    });
  }
  return { ...review, commit };
}
