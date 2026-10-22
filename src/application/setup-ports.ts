export type SetupStatus = {
  targetId: string;
  revision: number;
  state: "open" | "fresh" | "ynab";
  completedAt: string | null;
  importId: string | null;
};
export type SetupResult =
  | { ok: true; value: SetupStatus }
  | { ok: false; reason: "stale-version" | "setup-closed" | "setup-not-empty" };
export type SetupStore = {
  read: () => SetupStatus;
  chooseFresh: (expectedRevision: number, now: string) => SetupResult;
};
export type SetupRuntime = { now: () => string };
