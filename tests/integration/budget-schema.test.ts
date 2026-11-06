import { afterEach, expect, it } from "vitest";
import { initializeDatabase, openDatabase } from "../../src/storage/database.js";
import { createAccountStore } from "../../src/storage/accounts.js";
import { createAccounts } from "../../src/application/accounts.js";
import { temporaryDatabase } from "../helpers/database.js";
const fixtures: ReturnType<typeof temporaryDatabase>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.cleanup()));
it("installs empty budget tables without blocking first manual account creation", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const c = openDatabase(f.path);
  try {
    expect(c.sqlite.prepare("SELECT count(*) AS count FROM budget_state").get()).toEqual({
      count: 0,
    });
    expect(c.sqlite.prepare("SELECT count(*) AS count FROM budget_categories").get()).toEqual({
      count: 0,
    });
    expect(
      c.sqlite.prepare("SELECT count(*) AS count FROM budget_source_memberships").get(),
    ).toEqual({ count: 0 });
  } finally {
    c.sqlite.close();
  }
  const app = createAccounts(createAccountStore(f.path), {
    id: () => "cash",
    now: () => "2026-11-05T12:00:00.000Z",
    today: () => "2026-11-05",
  });
  const preview = app.previewAdd({
    name: "Synthetic Cash",
    kind: "cash",
    currency: "USD",
    openingCents: 100000,
    openingDate: "2026-09-30",
  });
  expect(preview.ok && app.commit(preview.value).ok).toBe(true);
  const check = openDatabase(f.path);
  try {
    check.sqlite.exec("INSERT INTO budget_groups (id,name) VALUES ('cards','Cards')");
    expect(() =>
      check.sqlite.exec(
        "INSERT INTO budget_categories (id,group_id,name,archived,position,card_account_id) VALUES ('wrong','cards','Wrong',0,0,'cash')",
      ),
    ).toThrow("credit account required");
  } finally {
    check.sqlite.close();
  }
});
it("rejects unsafe budget state, broken category links, and invalid allocation references", async () => {
  const f = temporaryDatabase();
  fixtures.push(f);
  await initializeDatabase(f.path);
  const c = openDatabase(f.path);
  try {
    expect(() =>
      c.sqlite.prepare("INSERT INTO budget_groups (id,name) VALUES (?,?)").run("living", "Living"),
    ).not.toThrow();
    expect(() =>
      c.sqlite
        .prepare(
          "INSERT INTO budget_categories (id,group_id,name,archived,position,card_account_id) VALUES ('food','missing','Food',0,0,NULL)",
        )
        .run(),
    ).toThrow();
    c.sqlite
      .prepare(
        "INSERT INTO budget_categories (id,group_id,name,archived,position,card_account_id) VALUES ('food','living','Food',0,0,NULL)",
      )
      .run();
    expect(() =>
      c.sqlite
        .prepare(
          "INSERT INTO budget_assignments (month,category_id,cents) VALUES ('2026-13','food',100)",
        )
        .run(),
    ).toThrow();
    expect(() =>
      c.sqlite
        .prepare(
          "INSERT INTO budget_assignments (month,category_id,cents) VALUES ('2026-11','food',1.5)",
        )
        .run(),
    ).toThrow();
    expect(() =>
      c.sqlite
        .prepare(
          "INSERT INTO budget_allocations (event_id,position,category_id,cents) VALUES ('absent',0,'food',100)",
        )
        .run(),
    ).toThrow();
  } finally {
    c.sqlite.close();
  }
});
