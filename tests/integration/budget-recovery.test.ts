import { afterEach, expect, it } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createBudget } from "../../src/application/budget.js";
import { createBudgetStore } from "../../src/storage/budget.js";
import { createRecovery } from "../../src/application/backup.js";
import { createRecoveryStore } from "../../src/storage/backup.js";
import { budgetFixture } from "../helpers/budget.js";
const fixtures: Awaited<ReturnType<typeof budgetFixture>>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
function value<T>(result: { ok: true; value: T } | { ok: false; reason: string }) {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
it("restores normalized facts, revisions, receipts and monthly calculations without changing the source", async () => {
  const f = await budgetFixture();
  fixtures.push(f);
  const app = createBudget(createBudgetStore(f.path), f.runtime);
  value(
    app.commit(
      value(
        app.preview(
          {
            kind: "activate",
            facts: f.facts,
            coverage: {
              throughDate: "2026-11-05",
              evidence: "Synthetic review",
              includedTransactionIds: [],
              postedBridgeEventIds: [],
            },
          },
          0,
        ),
      ),
    ),
  );
  const assignment = value(
    app.preview({ kind: "assign", month: "2026-10", categoryId: "food", amountCents: 20000 }, 1),
  );
  value(app.commit(assignment));
  const before = readFileSync(f.path),
    snapshot = app.inspect(),
    report = app.report("2026-11");
  const recovery = createRecovery(createRecoveryStore(), f.runtime.id);
  const backup = join(f.directory, "backup.sqlite"),
    restored = join(f.directory, "restored.sqlite");
  value(await recovery.commit(value(recovery.preview("backup", f.path, backup))));
  value(await recovery.commit(value(recovery.preview("restore", backup, restored))));
  expect(readFileSync(f.path)).toEqual(before);
  const reopened = createBudget(createBudgetStore(restored), f.runtime);
  expect(reopened.inspect()).toEqual(snapshot);
  expect(reopened.report("2026-11")).toEqual(report);
  expect(reopened.commit(assignment)).toMatchObject({
    ok: true,
    value: { reused: true, revision: 2 },
  });
});
