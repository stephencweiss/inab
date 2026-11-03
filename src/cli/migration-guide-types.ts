import type { migrationApplication } from "../bootstrap.js";
import type { ReviewChange } from "../application/import-ports.js";
import type { TerminalPrompts } from "./prompts.js";
export type MigrationView = ReturnType<ReturnType<typeof migrationApplication>["inspect"]>;
export type GuideSession = {
  read: () => MigrationView;
  save: (change: ReviewChange) => Promise<void>;
  prompts: TerminalPrompts;
  say: (text: string) => void;
};
