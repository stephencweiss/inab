import { describe, expect, it } from "vitest";
import { balances, validateRegisterEntry } from "../../src/accounts/balances.js";
import type { Account, RegisterAccount, RegisterEntry } from "../../src/accounts/types.js";

const cash: RegisterAccount = {
  id: "cash-1",
  name: "Synthetic cash",
  kind: "cash",
  currency: "USD",
  openingCents: 100000,
  openingDate: "2026-10-16",
};
const pending: RegisterEntry = {
  id: "pending-1",
  accountId: cash.id,
  cents: -6000,
  occurredOn: "2026-10-17",
  postedOn: null,
};
const cleared: RegisterEntry = {
  id: "cleared-1",
  accountId: cash.id,
  cents: -2500,
  occurredOn: "2026-10-17",
  postedOn: "2026-10-17",
};

describe("manual account balances", () => {
  it("keeps pending purchases outside cleared balance", () => {
    expect(balances(cash, [pending, cleared], "2026-10-17")).toEqual({
      ok: true,
      value: {
        workingCents: 91500,
        clearedCents: 97500,
        unclearedCents: -6000,
      },
    });
  });

  it.each([-25000, 25000, 0])("preserves credit balance sign %s", (openingCents) => {
    expect(balances({ ...cash, kind: "credit", openingCents }, [], cash.openingDate)).toEqual({
      ok: true,
      value: {
        workingCents: openingCents,
        clearedCents: openingCents,
        unclearedCents: 0,
      },
    });
  });

  it("counts old pending purchases and later posting without duplication", () => {
    const old = { ...pending, occurredOn: "2026-10-10" };
    expect(balances(cash, [old], "2026-10-17")).toEqual({
      ok: true,
      value: {
        workingCents: 94000,
        clearedCents: 100000,
        unclearedCents: -6000,
      },
    });
    expect(balances(cash, [{ ...old, postedOn: "2026-10-18" }], "2026-10-17")).toEqual({
      ok: true,
      value: {
        workingCents: 94000,
        clearedCents: 100000,
        unclearedCents: 0,
      },
    });
    expect(balances(cash, [{ ...old, postedOn: "2026-10-18" }], "2026-10-18")).toEqual({
      ok: true,
      value: {
        workingCents: 94000,
        clearedCents: 94000,
        unclearedCents: 0,
      },
    });
  });

  it.each(["2026-10-15", "2026-10-16"])("rejects posting within opening period %s", (postedOn) => {
    expect(
      balances(cash, [{ ...pending, occurredOn: "2026-10-10", postedOn }], "2026-10-17"),
    ).toEqual({ ok: false, reason: "posting-in-opening-period" });
  });

  it("rejects posting before occurrence", () => {
    expect(
      balances(
        cash,
        [{ ...pending, occurredOn: "2026-10-18", postedOn: "2026-10-17" }],
        "2026-10-18",
      ),
    ).toEqual({ ok: false, reason: "posting-before-occurrence" });
  });

  it("rejects an invalid cutoff or one before opening", () => {
    expect(balances(cash, [], "2026-02-29")).toEqual({ ok: false, reason: "invalid-date" });
    expect(balances(cash, [], "2026-10-15")).toEqual({
      ok: false,
      reason: "cutoff-before-opening",
    });
  });

  it("rejects Tracking register balances", () => {
    const tracking: Account = {
      id: "tracking-1",
      name: "Synthetic tracking",
      kind: "tracking",
      currency: "USD",
      openingCents: null,
      openingDate: null,
    };
    expect(balances(tracking, [], "2026-10-17")).toEqual({
      ok: false,
      reason: "tracking-register",
    });
  });

  it("rejects invalid opening amounts, entries, and ownership", () => {
    expect(balances({ ...cash, openingCents: 0.1 }, [], "2026-10-17")).toEqual({
      ok: false,
      reason: "unsafe-cents",
    });
    expect(balances({ ...cash, openingDate: "2026-02-29" }, [], "2026-10-17")).toEqual({
      ok: false,
      reason: "invalid-date",
    });
    expect(balances(cash, [{ ...pending, cents: 0 }], "2026-10-17")).toEqual({
      ok: false,
      reason: "zero-transaction",
    });
    expect(balances(cash, [{ ...pending, occurredOn: "2026-02-29" }], "2026-10-17")).toEqual({
      ok: false,
      reason: "invalid-date",
    });
    expect(balances(cash, [{ ...cleared, postedOn: "2026-02-29" }], "2026-10-17")).toEqual({
      ok: false,
      reason: "invalid-date",
    });
    expect(balances(cash, [{ ...pending, accountId: "other" }], "2026-10-17")).toEqual({
      ok: false,
      reason: "wrong-account",
    });
  });

  it("rejects future activity against a separate injected today", () => {
    expect(validateRegisterEntry(cash, pending, "2026-10-16")).toEqual({
      ok: false,
      reason: "future-activity",
    });
    expect(
      validateRegisterEntry(cash, { ...cleared, postedOn: "2026-10-18" }, "2026-10-17"),
    ).toEqual({ ok: false, reason: "future-activity" });
    expect(validateRegisterEntry(cash, pending, "2026-10-17")).toEqual({
      ok: true,
      value: pending,
    });
    expect(validateRegisterEntry(cash, pending, "invalid")).toEqual({
      ok: false,
      reason: "invalid-date",
    });
  });

  it.each([
    [{ ...cash, openingCents: Number.MAX_SAFE_INTEGER }, [{ ...pending, cents: 1 }]],
    [cash, [{ ...pending, cents: Number.MAX_SAFE_INTEGER }]],
    [cash, [{ ...pending, cents: NaN }]],
    [
      { ...cash, openingCents: 0 },
      [
        { ...pending, cents: Number.MAX_SAFE_INTEGER },
        { ...pending, id: "second", cents: 1 },
        { ...pending, id: "third", cents: -1 },
      ],
    ],
  ])("rejects unsafe inputs or intermediate balance sums", (account, entries) => {
    expect(balances(account, entries, "2026-10-17")).toEqual({ ok: false, reason: "unsafe-cents" });
  });
});
