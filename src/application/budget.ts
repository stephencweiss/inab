import { calculateBudget } from "../budget/calculate.js";
export { parseBudgetFacts } from "../budget/parse.js";
import { applyBudgetCommand } from "./budget-operations.js";
import type {
  BudgetCommand,
  BudgetPreview,
  BudgetStore,
  BudgetRuntime,
  BudgetResult,
} from "./budget-ports.js";
export function createBudget(store: BudgetStore, runtime: BudgetRuntime) {
  function inspect() {
    return store.read((s) => s.snapshot());
  }
  function preview(command: BudgetCommand, expectedRevision: number): BudgetResult<BudgetPreview> {
    return store.read((session) => {
      const snapshot = session.snapshot();
      if (expectedRevision !== (snapshot.state?.revision ?? 0))
        return { ok: false, reason: "stale-version" };
      const operationId = runtime.id();
      const transferLegIds =
        command.kind === "transfer"
          ? {
              from: command.fromTransactionId ?? runtime.id(),
              to: command.toTransactionId ?? runtime.id(),
            }
          : null;
      const result = applyBudgetCommand(
        snapshot,
        command,
        runtime.today(),
        operationId,
        transferLegIds,
      );
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          command,
          baseline: JSON.stringify(snapshot),
          expectedRevision,
          operationId,
          recordedAt: runtime.now(),
          after: result.value.facts,
          coverage: result.value.coverage,
          transferLegIds,
        },
      };
    });
  }
  function commit(
    value: BudgetPreview,
  ): BudgetResult<{ operationId: string; revision: number; reused: boolean }> {
    try {
      return store.write((session) => {
        const snapshot = session.snapshot();
        const receipt = session.receipt(value.operationId);
        if (receipt !== null) {
          if (receipt.afterJson !== JSON.stringify(value.after))
            return { ok: false, reason: "invalid-preview" };
          return {
            ok: true,
            value: { operationId: value.operationId, revision: receipt.revision, reused: true },
          };
        }
        if (snapshot.state?.receipt.operationId === value.operationId)
          return {
            ok: true,
            value: {
              operationId: value.operationId,
              revision: snapshot.state.revision,
              reused: true,
            },
          };
        if (
          JSON.stringify(snapshot) !== value.baseline ||
          (snapshot.state?.revision ?? 0) !== value.expectedRevision
        )
          return { ok: false, reason: "stale-version" };
        const checked = applyBudgetCommand(
          snapshot,
          value.command,
          runtime.today(),
          value.operationId,
          value.transferLegIds,
        );
        if (!checked.ok) return checked;
        if (
          JSON.stringify(checked.value.facts) !== JSON.stringify(value.after) ||
          JSON.stringify(checked.value.coverage) !== JSON.stringify(value.coverage)
        )
          return { ok: false, reason: "invalid-preview" };
        session.save(value);
        return {
          ok: true,
          value: {
            operationId: value.operationId,
            revision: value.expectedRevision + 1,
            reused: false,
          },
        };
      });
    } catch (error) {
      throw new Error(
        `Operation ID: ${value.operationId}. ${error instanceof Error ? error.message : "Storage failure"}`,
        { cause: error },
      );
    }
  }
  function report(month: string) {
    return store.read((session) => {
      const snapshot = session.snapshot(),
        state = snapshot.state;
      if (!state) return { ok: false as const, reason: "budget-inactive" };
      if (state.status !== "active") return { ok: false as const, reason: "opening-needs-review" };
      const result = calculateBudget(state.facts, month);
      if (!result.ok) return result;
      const value = result.months.at(-1);
      if (!value) return { ok: false as const, reason: "invalid-report-horizon" };
      return {
        ok: true as const,
        value: {
          revision: state.revision,
          status: state.status,
          startMonth: state.facts.startMonth,
          month: value,
          categories: state.facts.categories,
        },
      };
    });
  }
  return { inspect, preview, commit, report };
}
