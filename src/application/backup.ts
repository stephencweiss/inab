import type { RecoveryOperation, RecoveryPreview, RecoveryResult, RecoveryStore } from "./ports.js";

export class RecoveryStorageError extends Error {
  constructor(
    readonly operationId: string,
    readonly destination: string,
    cause: Error | object,
  ) {
    super(
      `Operation ID: ${operationId}. Destination: ${destination}. ${cause instanceof Error ? cause.message : "Storage failure"}. Inspect the destination before any retry.`,
      { cause },
    );
  }
}

/** Recovery copies records unchanged. It does not write audit entries or migrate the source. */
export function createRecovery(store: RecoveryStore, id: () => string) {
  function preview(
    operation: RecoveryOperation,
    source: string,
    destination: string,
  ): RecoveryResult<RecoveryPreview> {
    const operationId = id();
    try {
      const inspected = store.inspect(source, destination);
      return inspected.ok
        ? { ok: true, value: { ...inspected.value, operation, operationId } }
        : inspected;
    } catch (error) {
      throw new RecoveryStorageError(operationId, destination, error instanceof Error ? error : {});
    }
  }
  async function commit(preview: RecoveryPreview) {
    try {
      const result = await store.copy(preview);
      return result.ok
        ? { ok: true as const, value: { ...result.value, operationId: preview.operationId } }
        : result;
    } catch (error) {
      throw new RecoveryStorageError(
        preview.operationId,
        preview.destination,
        error instanceof Error ? error : {},
      );
    }
  }
  return { preview, commit };
}
