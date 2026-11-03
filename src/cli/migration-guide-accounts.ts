import { formatCents } from "./render.js";
import {
  choice,
  text,
  dateAnswer,
  moneyAnswer,
  accountClosed,
  keepSaved,
} from "./migration-questions.js";
import type { GuideSession } from "./migration-guide-types.js";

export async function reviewAccount(session: GuideSession, sourceAccountKey: string) {
  const view = session.read();
  const source = view.sourceAccounts.find((entry) => entry.key === sourceAccountKey);
  const existing = view.derived.accounts.find((entry) => entry.key === sourceAccountKey);
  const label = existing?.name ?? source?.name;
  if (label === undefined) throw new Error("unknown-source-account");
  if (existing) {
    session.say(
      `Saved account: ${existing.name}; kind ${existing.kind}; closed ${existing.closed ? "yes" : "no"}.`,
    );
    if (await keepSaved(session.prompts, "Saved mapping", "account-kind")) return;
  }
  const name = await text(session.prompts, "Account name", label);
  session.say("\nnext up: account kind. Please pick between:");
  session.say(
    "cash: checking, savings, or cash in the budget. credit: credit card. tracking: an account outside the budget, such as investments.",
  );
  const kind = await choice(
    session.prompts,
    "Account kind",
    ["cash", "credit", "tracking"],
    "abandon",
    "account-kind",
  );
  if (kind !== "cash" && kind !== "credit" && kind !== "tracking")
    throw new Error("invalid-account-kind");
  const closed = await accountClosed(session.prompts);
  await session.save({
    tag: "account",
    sourceAccount: sourceAccountKey,
    name,
    kind,
    closed,
    newGroup: false,
  });
}

export async function reviewOpening(session: GuideSession, accountKey: string) {
  const account = session.read().derived.accounts.find((entry) => entry.key === accountKey);
  if (!account || account.kind === "tracking") return;
  session.say("\nOpening balance:");
  session.say(
    `${account.name}: this is the starting point for new activity in INAB. Use the bank's posted closing balance on your chosen date. Imported history covered by this balance is not added again. Use help for date guidance.`,
  );
  if (account.kind === "credit") session.say("Enter the amount owed as a negative USD balance.");
  if (account.openingDate !== null && account.openingCents !== null) {
    session.say(`Saved opening: ${account.openingDate}; ${formatCents(account.openingCents)} USD.`);
    if (await keepSaved(session.prompts, "Saved opening", "opening-balance")) return;
  }
  const date = await dateAnswer(
    session.prompts,
    "Posted closing balance date",
    session.read().derived.asOfDate,
  );
  const cents = await moneyAnswer(session.prompts, "Opening balance", "opening-balance");
  await session.save({ tag: "opening", accountKey, date, cents });
}
