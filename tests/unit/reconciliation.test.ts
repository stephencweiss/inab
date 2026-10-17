import { expect, it } from "vitest";
import { reconciliationSnapshot, evidenceMatches } from "../../src/accounts/reconciliation.js";
const account = {
  id: "a",
  name: "Synthetic",
  kind: "cash" as const,
  currency: "USD" as const,
  openingCents: 100000,
  openingDate: "2026-10-16",
  revision: 3,
};
const posted = {
  id: "posted",
  accountId: "a",
  cents: -2500,
  occurredOn: "2026-10-17",
  postedOn: "2026-10-17",
  revision: 1,
};
const pending = { ...posted, id: "pending", cents: -6000, postedOn: null };
it("compares the bank with posted activity and preserves signed credit debt", () => {
  expect(reconciliationSnapshot(account, [pending, posted], "2026-10-17", 97000)).toMatchObject({
    ok: true,
    value: {
      computedCents: 97500,
      differenceCents: -500,
      entries: [
        { transactionId: "posted", transactionRevision: 1, cents: -2500, postedOn: "2026-10-17" },
      ],
    },
  });
  expect(
    reconciliationSnapshot(
      { ...account, kind: "credit", openingCents: -100000 },
      [posted],
      "2026-10-17",
      -102500,
    ),
  ).toMatchObject({ ok: true, value: { computedCents: -102500, differenceCents: 0 } });
});
it("compares balance values and the complete covered set while retaining original revisions", () => {
  const result = reconciliationSnapshot(account, [pending, posted], "2026-10-17", 97500);
  if (!result.ok) throw new Error("Expected snapshot");
  const snapshot = result.value;
  expect(
    evidenceMatches(snapshot, account, [
      { ...posted, revision: 2 },
      { ...pending, cents: -1 },
    ]),
  ).toBe(true);
  for (const entries of [
    [{ ...posted, cents: -2499 }],
    [{ ...posted, accountId: "other" }],
    [{ ...posted, postedOn: "2026-10-18" }],
    [posted, { ...posted, id: "extra", cents: 1 }, { ...posted, id: "offset", cents: -1 }],
  ])
    expect(evidenceMatches(snapshot, account, entries)).toBe(false);
  expect(evidenceMatches(snapshot, { ...account, openingCents: 99999 }, [posted])).toBe(false);
  expect(snapshot.entries[0]?.transactionRevision).toBe(1);
});
it("supports empty accounts and earlier cutoffs and rejects invalid dates, membership and overflow", () => {
  expect(reconciliationSnapshot(account, [], "2026-10-16", 100000)).toMatchObject({
    ok: true,
    value: { entries: [], differenceCents: 0 },
  });
  expect(reconciliationSnapshot(account, [posted], "2026-10-16", 100000)).toMatchObject({
    ok: true,
    value: { entries: [] },
  });
  for (const cutoff of ["2026-10-15", "2026-02-30"])
    expect(reconciliationSnapshot(account, [], cutoff, 0).ok).toBe(false);
  expect(
    reconciliationSnapshot(account, [{ ...posted, accountId: "other" }], "2026-10-17", 0).ok,
  ).toBe(false);
  expect(
    reconciliationSnapshot(
      { ...account, openingCents: Number.MAX_SAFE_INTEGER },
      [],
      "2026-10-17",
      Number.MIN_SAFE_INTEGER,
    ),
  ).toEqual({ ok: false, reason: "unsafe-cents" });
});
it("rejects unsafe account revisions and preserves earlier coverage with later postings", () => {
  expect(reconciliationSnapshot({ ...account, revision: 0 }, [], "2026-10-17", 100000)).toEqual({
    ok: false,
    reason: "invalid-reconciliation",
  });
  const result = reconciliationSnapshot(account, [posted], "2026-10-17", 97500);
  if (!result.ok) throw new Error("Expected snapshot");
  expect(
    evidenceMatches(result.value, account, [
      posted,
      { ...posted, id: "later", postedOn: "2026-10-18" },
    ]),
  ).toBe(true);
  expect(evidenceMatches(result.value, { ...account, openingDate: "2026-10-15" }, [posted])).toBe(
    false,
  );
});
