import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function temporaryDatabase() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "inab-storage-")));
  return {
    directory,
    path: join(directory, "private", "plan.sqlite"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
