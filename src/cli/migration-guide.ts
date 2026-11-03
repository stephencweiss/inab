import { visibleReviewIssues, reviewIssueTitle, reviewIssueChanges } from "./migration-issues.js";
import { migrationProgress } from "./migration-progress.js";
import { formatCents } from "./render.js";
import { migrationApplication } from "../bootstrap.js";
import type { SetupCommand } from "./setup-parse.js";
import { requireSetupFlag } from "./setup-parse.js";
import type { TerminalPrompts } from "./prompts.js";
import { renderMigrationChoice } from "./migration-choice.js";
import { choice, confirm, startReview, saveChoice } from "./migration-questions.js";
import type { GuideSession } from "./migration-guide-types.js";
import { reviewAccount, reviewOpening } from "./migration-guide-accounts.js";
import { reviewHistory, reviewEvidence } from "./migration-guide-history.js";

function summary(session: GuideSession) {
  const view = session.read();
  session.say("\nMigration summary:");
  for (const account of view.derived.accounts) {
    const opening =
      account.openingDate === null || account.openingCents === null
        ? "not set"
        : `${account.openingDate}: ${formatCents(account.openingCents)} USD`;
    session.say(
      `${account.name}: ${account.kind}; closed ${account.closed ? "yes" : "no"}; opening ${opening}.`,
    );
  }
  session.say(
    `Source rows: ${view.report.sourceRows}; history only: ${view.report.historyOnly}; live linked: ${view.report.liveLinked}; observation evidence: ${view.report.observationEvidence}.`,
  );
  for (const issue of visibleReviewIssues(view))
    session.say(`${issue.blocking ? "Required" : "Warning"}: ${reviewIssueTitle(issue)}.`);
  for (const observation of view.observations) {
    const account = view.derived.accounts.find(
      (entry) => entry.key === observation.decision.accountKey,
    );
    const value = (cents: number | null) =>
      cents === null ? "unknown" : `${formatCents(cents)} USD`;
    session.say(
      `${account?.name ?? "Tracking account"} on ${observation.decision.date}: ${observation.check.status}; observed ${value(observation.check.observedCents)}; recorded ${value(observation.check.recordedCents)}; difference ${value(observation.check.differenceCents)}; adjustment ${value(observation.check.adjustmentCents)}.`,
    );
  }
  session.say(`Remaining required review steps: ${migrationProgress(view).remaining}.`);
}

async function prepareAccounts(session: GuideSession) {
  const sources = session.read().sourceAccounts;
  for (const [index, source] of sources.entries()) {
    session.say(`\nAccount ${index + 1} of ${sources.length}: ${source.name}`);
    const mapped = session
      .read()
      .derived.accounts.filter((account) => account.sourceAccount === source.key);
    if (mapped.length === 0) await reviewAccount(session, source.key);
    else for (const account of mapped) await reviewAccount(session, account.key);
  }
  for (const account of session.read().derived.accounts) {
    await reviewOpening(session, account.key);
    if ((await reviewHistory(session, account.key)) === "summary") return;
  }
}

function nextReviewAction(prompts: TerminalPrompts, ready: boolean) {
  return choice(
    prompts,
    ready ? "Review complete. Next" : "Review has required issues. Next",
    ready ? ["import", "review", "save"] : ["review", "save"],
    "abandon",
    "review",
    ready ? null : "review",
  );
}

export async function guidedMigrationReview(
  command: SetupCommand,
  prompts: TerminalPrompts,
): Promise<object> {
  const path = requireSetupFlag(command, "--review");
  const app = migrationApplication(command.database);
  let view = app.inspect(path);
  const initial = migrationProgress(view);
  const seenSteps = new Set(initial.steps.map((step) => step.key));
  const session: GuideSession = {
    prompts,
    read: () => view,
    say: (message) => {
      process.stderr.write(`${message}\n`);
    },
    save: async (change) => {
      session.say(`\nReview choice:\n${renderMigrationChoice(view, change)}`);
      if (!(await saveChoice(prompts))) return;
      const previous = view;
      view = await app.change(path, view.revision, change);
      for (const message of reviewIssueChanges(previous, view)) session.say(message);
      const progress = migrationProgress(view);
      for (const step of progress.steps) seenSteps.add(step.key);
      const addressed = seenSteps.size - progress.remaining;
      const remaining =
        progress.remaining === 1
          ? "1 required step remains"
          : `${progress.remaining} required steps remain`;
      session.say(
        `\nChoice saved. Review revision ${view.revision}.\nReview progress: ${addressed} of ${seenSteps.size} steps addressed; ${remaining}.`,
      );
    },
  };
  session.say(
    `Migration review\nDatabase: ${command.database}\nReview file: ${path}\nThis session saves migration choices in the review file. No household records enter the database until you confirm import. Enter help for definitions, b to go back where shown, or a to abandon the session. Each question shows its letter shortcuts. Saved choices remain; run the same review command to resume.`,
  );
  session.say(
    "\nMoving from YNAB to INAB\n\n1. Keep YNAB transactions as history. They remain available for inspection and do not change active balances. Monthly plan records are also kept for inspection.\n\n2. Set starting balances for Cash and Credit accounts. Use the bank's posted closing balance on your chosen starting date. Imported history covered by that balance is not added again. Credit-card debt is negative.\n\n3. Start using INAB. After you confirm import, record new activity in INAB. Cash and Credit transactions posted after the starting date change the balance. Pending activity does not change the posted balance.\n\nMoving imported rows into the active register is optional; the normal path keeps them as history. Tracking accounts use reviewed balance observations and adjustments instead of a Cash/Credit starting balance.\n\nThis guide will help you map accounts, set balances, and acknowledge export limits before the separate import confirmation.",
  );
  session.say(`\nRequired review steps: ${initial.remaining}.`);
  initial.steps.forEach((step, index) => session.say(`${index + 1}. ${step.label}`));
  if (initial.conditional)
    session.say(
      "Opening-balance steps apply only to Cash/Credit accounts. The step count can change as account choices and source evidence are reviewed.",
    );
  else session.say("The step count can change if new issues are found.");
  session.say(`Warnings: ${initial.warnings} (separate from required steps).`);
  if (!(await startReview(prompts))) return view;
  await prepareAccounts(session);
  for (;;) {
    summary(session);
    const action = await nextReviewAction(prompts, view.derived.ready);
    if (action === "save") {
      session.say(
        "Review saved. Run the same review command to resume. Import has not been confirmed.",
      );
      return view;
    }
    if (action === "review") {
      await reviewEvidence(session);
      continue;
    }
    session.say(
      `\nImport:\nTarget: ${command.database}\nImport completes setup and prevents later YNAB imports into this database. A backup is created before the import.`,
    );
    if (!(await confirm(prompts, "Confirm import?", "import-confirmation"))) continue;
    const receipt = await app.commit(path, view.revision);
    session.say(
      `Import complete. Source rows: ${receipt.report.sourceRows}. Backup: ${receipt.backupPath}`,
    );
    return receipt;
  }
}
