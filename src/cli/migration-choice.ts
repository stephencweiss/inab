import type { ReviewChange } from "../application/import-ports.js";
import type { MigrationView } from "./migration-guide-types.js";
import { formatCents } from "./render.js";

function accountName(view: MigrationView, key: string | null) {
  return view.derived.accounts.find((account) => account.key === key)?.name ?? "Unassigned account";
}
function accountChoice(view: MigrationView, change: Extract<ReviewChange, { tag: "account" }>) {
  const mapped = view.derived.accounts.find((account) => account.key === change.sourceAccount);
  const sourceKey = mapped?.sourceAccount ?? change.sourceAccount;
  const index = view.sourceAccounts.findIndex((account) => account.key === sourceKey);
  return `Account ${index + 1} of ${view.sourceAccounts.length}: ${change.name}\nKind: ${change.kind}\nClosed: ${change.closed ? "yes" : "no"}`;
}
function rowChoice(view: MigrationView, change: Extract<ReviewChange, { tag: "row" }>) {
  const row = view.derived.rows.find((entry) => entry.key === change.key);
  const source = view.derived.sourceRegisterRows.find((entry) => entry.key === change.key);
  const amount =
    source?.value === null || source?.value === undefined
      ? "unknown"
      : `${formatCents(source.value.cents)} USD`;
  return `Account: ${accountName(view, change.accountKey ?? row?.accountKey ?? null)}\nSource row: ${source?.ordinal ?? "unknown"}\nDate: ${source?.value?.occurredOn ?? "unknown"}\nAmount: ${amount}\nPayee: ${change.payee ?? source?.value?.payee ?? "(empty)"}\nTreatment: ${change.treatment}\nPosted on: ${change.postedOn ?? "not posted"}\nRole: ${change.role}`;
}
export function renderMigrationChoice(view: MigrationView, change: ReviewChange): string {
  switch (change.tag) {
    case "account":
      return accountChoice(view, change);
    case "opening":
      return `Account: ${accountName(view, change.accountKey)}\nOpening date: ${change.date}\nOpening balance: ${formatCents(change.cents)} USD`;
    case "row":
      return rowChoice(view, change);
    case "observation":
      return `Account: ${accountName(view, change.accountKey)}\nObservation date: ${change.date}\nObserved balance: ${formatCents(change.cents)} USD\nAdjustment source row: ${view.derived.sourceRegisterRows.find((row) => row.key === change.rowKey)?.ordinal ?? "unknown"}`;
    case "resolve": {
      const observation = view.observations.find((entry) => entry.decision.key === change.key);
      const label = observation
        ? `${accountName(view, observation.decision.accountKey)} on ${observation.decision.date}`
        : "Unknown observation";
      return `Observation: ${label}\nResolution: ${change.choice}`;
    }
    case "ack": {
      const issue = view.derived.issues.find((entry) => entry.key === change.key);
      const account = view.derived.accounts.find((entry) => change.key === `history:${entry.key}`);
      const heading = account ? `Account: ${account.name}\n` : "";
      return `${heading}Acknowledgement: ${issue?.reason.replaceAll("-", " ") ?? "unknown issue"}\nSource-only history stays outside live balances.`;
    }
  }
}
