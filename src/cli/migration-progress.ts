import { visibleReviewIssues } from "./migration-issues.js";
import type { MigrationView } from "./migration-guide-types.js";

function issueLabel(view: MigrationView, key: string, reason: string) {
  const account = view.derived.accounts.find(
    (candidate) => key === `opening:${candidate.key}` || key === `history:${candidate.key}`,
  );
  if (account && reason === "missing-opening") return `Set opening balance: ${account.name}`;
  if (account && reason === "unverified-history-coverage")
    return `Review history coverage: ${account.name}`;
  return reason.replaceAll("-", " ");
}

/** Includes conditional planning steps before account kinds are known, not only current blockers. */
export function migrationProgress(view: MigrationView): {
  steps: { key: string; label: string }[];
  remaining: number;
  warnings: number;
  conditional: boolean;
} {
  const steps = new Map<string, string>();
  const unmapped = view.sourceAccounts.filter(
    (source) => !view.derived.accounts.some((account) => account.sourceAccount === source.key),
  );
  const unmappedNames = new Set(unmapped.map((source) => source.name));
  for (const source of unmapped) {
    steps.set(`mapping:${source.key}`, `Set up account: ${source.name}`);
    steps.set(`opening:${source.key}`, `Set opening balance if Cash or Credit: ${source.name}`);
    steps.set(`history:${source.key}`, `Review history coverage: ${source.name}`);
  }
  for (const issue of visibleReviewIssues(view)) {
    if (!issue.blocking || steps.has(issue.key)) continue;
    if (issue.reason === "missing-account-mapping" && issue.rowKey !== null) {
      const source = view.derived.sourceRegisterRows.find((row) => row.key === issue.rowKey);
      if (source?.value && unmappedNames.has(source.value.account)) continue;
    }
    steps.set(issue.key, issueLabel(view, issue.key, issue.reason));
  }
  return {
    steps: [...steps].map(([key, label]) => ({ key, label })),
    remaining: steps.size,
    warnings: view.derived.issues.filter((issue) => !issue.blocking).length,
    conditional: unmapped.length > 0,
  };
}
