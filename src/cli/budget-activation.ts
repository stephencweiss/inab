import { budgetPreviewSummary } from "./budget-preview.js";
import { lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  budgetApplication,
  createBudgetReview,
  readBudgetReview,
  updateBudgetReview,
  withBudgetReviewLock,
  writeBudgetReview,
  parseBudgetCoverage,
  localToday,
} from "../bootstrap.js";
import type { BudgetReview } from "../bootstrap.js";
import type { BudgetSnapshot, BudgetResult } from "../application/budget-ports.js";
import { parseBudgetFacts, parseMonth } from "../budget/parse.js";
import type { TerminalPrompts } from "./prompts.js";
import { PromptCancelled } from "./prompts.js";
import { confirm } from "./migration-questions.js";
import { guideBudgetActivation } from "./budget-guide.js";
import type { BudgetTerminalCommand } from "./budget-parse.js";
import { budgetFlag, budgetInteger } from "./budget-parse.js";
export function budgetValue<T>(result: BudgetResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
function assertBound(
  review: BudgetReview,
  command: BudgetTerminalCommand,
  snapshot: BudgetSnapshot,
) {
  assertTarget(review, command, snapshot);
  if (review.baseline !== JSON.stringify(snapshot)) throw new Error("stale-review-baseline");
}
function assertTarget(
  review: BudgetReview,
  command: BudgetTerminalCommand,
  snapshot: BudgetSnapshot,
) {
  const file = lstatSync(command.database, { bigint: true });
  if (
    review.targetId !== snapshot.targetId ||
    resolve(review.targetPath) !== resolve(command.database)
  )
    throw new Error("wrong-review-target");
  if (review.targetDevice !== String(file.dev) || review.targetInode !== String(file.ino))
    throw new Error("stale-target");
}
function revision(command: BudgetTerminalCommand) {
  return budgetInteger(
    command.flags.get("--expected-review") ?? budgetFlag(command, "--expected-version"),
    1,
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseActivationDecision(value: unknown) {
  if (!isRecord(value) || value.kind !== "facts") throw new Error("invalid-activation-decision");
  return {
    facts: budgetValue(parseBudgetFacts(value.facts)),
    coverage: parseBudgetCoverage(value.coverage),
  };
}
export async function executeBudgetActivation(
  command: BudgetTerminalCommand,
  prompts: TerminalPrompts,
  today: string,
) {
  const path = budgetFlag(command, "--review"),
    app = budgetApplication(command.database);
  if (command.action === "activation start" || command.action === "opening amend") {
    return startReview(command, path, app, today);
  }
  const initial = readBudgetReview(path);
  if (command.action === "activation commit") {
    return commitReview(command, prompts, path, app);
  }
  assertBound(initial, command, app.inspect());
  if (command.action === "activation set") {
    const decision = parseActivationDecision(JSON.parse(budgetFlag(command, "--decision")));
    if (decision.facts.startMonth !== initial.month) throw new Error("review-month-mismatch");
    const review = await updateBudgetReview(path, revision(command), (current) => {
      assertBound(current, command, app.inspect());
      return {
        ...current,
        ...decision,
        revision: current.revision + 1,
        preview: null,
        answers: [],
        answerThroughDate: today,
        draft: null,
      };
    });
    return { review };
  }
  if (command.action === "activation review") {
    if (command.json || !prompts.interactive) {
      if (command.interactive) throw new Error("interactive-terminal-required");
      return { review: initial };
    }
    return withBudgetReviewLock(path, async () => {
      const review = readBudgetReview(path);
      assertBound(review, command, app.inspect());
      const next = await guideBudgetActivation(review, app.inspect(), prompts, today, (current) =>
        writeBudgetReview(path, current),
      );
      return { review: next };
    });
  }
  if (command.action === "activation preview") {
    return withBudgetReviewLock(path, () => {
      const review = readBudgetReview(path);
      assertBound(review, command, app.inspect());
      if (!review.facts || !review.coverage) throw new Error("activation-review-incomplete");
      const preview = budgetValue(
        app.preview(
          { kind: review.mode, facts: review.facts, coverage: review.coverage },
          review.expectedBudgetRevision,
        ),
      );
      if (preview.baseline !== review.baseline) throw new Error("stale-review-baseline");
      const next = { ...review, revision: review.revision + 1, preview };
      writeBudgetReview(path, next);
      return {
        review: next,
        preview,
        summary: budgetPreviewSummary(app.inspect().state?.facts ?? null, preview.after, today),
      };
    });
  }
  throw new Error("invalid-budget-command");
}

function startReview(
  command: BudgetTerminalCommand,
  path: string,
  app: ReturnType<typeof budgetApplication>,
  today: string,
) {
  const month = budgetValue(parseMonth(budgetFlag(command, "--month")));
  if (month > today.slice(0, 7)) throw new Error("future-start-month");
  const snapshot = app.inspect(),
    amend = command.action === "opening amend" || command.flags.has("--amend");
  if (amend && snapshot.state === null) throw new Error("budget-inactive");
  if (!amend && snapshot.state !== null) throw new Error("budget-active");
  const review: BudgetReview = {
    format: 1,
    id: randomUUID(),
    revision: 1,
    targetPath: resolve(command.database),
    targetId: snapshot.targetId,
    targetDevice: String(lstatSync(command.database, { bigint: true }).dev),
    targetInode: String(lstatSync(command.database, { bigint: true }).ino),
    baseline: JSON.stringify(snapshot),
    expectedBudgetRevision: snapshot.state?.revision ?? 0,
    month,
    mode: amend ? "amend-opening" : "activate",
    facts: null,
    coverage: null,
    preview: null,
    answers: [],
    answerThroughDate: today,
    draft: null,
  };
  createBudgetReview(path, review);
  return { review };
}

function commitReview(
  command: BudgetTerminalCommand,
  prompts: TerminalPrompts,
  path: string,
  app: ReturnType<typeof budgetApplication>,
) {
  return withBudgetReviewLock(path, async () => {
    const review = readBudgetReview(path);
    if (review.revision !== revision(command)) throw new Error("stale-review");
    assertTarget(review, command, app.inspect());
    if (!review.preview) throw new Error("activation-preview-required");
    if (
      review.preview.baseline !== review.baseline ||
      review.preview.expectedRevision !== review.expectedBudgetRevision
    )
      throw new Error("invalid-review-preview");
    if (!command.confirm) {
      if (command.json || !prompts.interactive) throw new Error("confirm-required");
      process.stderr.write(
        `Target: ${command.database}\n${JSON.stringify(review.preview, null, 2)}\n${JSON.stringify(budgetPreviewSummary(app.inspect().state?.facts ?? null, review.preview.after, localToday()), null, 2)}\n`,
      );
      if (!(await confirm(prompts, "Activate this reviewed budget?"))) throw new PromptCancelled();
    }
    return budgetValue(app.commit(review.preview));
  });
}
