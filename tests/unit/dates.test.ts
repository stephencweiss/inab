import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseDate } from "../../src/lib/date.js";

describe("calendar dates", () => {
  it.each(["2024-02-29", "2000-02-29", "2026-10-17", "0001-01-01", "9999-12-31"])(
    "accepts %s unchanged",
    (date) => {
      expect(parseDate(date)).toEqual({ ok: true, value: date });
    },
  );

  it.each([
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "0000-01-01",
    "2026-1-01",
    "2026-10-17T00:00:00Z",
    " 2026-10-17",
    "2026-10-17\n",
    null,
    20261017,
  ])("rejects %s", (date) => {
    expect(parseDate(date)).toEqual({ ok: false, reason: "invalid-date" });
  });

  it.each(["Pacific/Honolulu", "America/Chicago", "Pacific/Kiritimati"])(
    "keeps dates unchanged in %s",
    (timezone) => {
      const script = `import { parseDate } from './src/lib/date.ts'; console.log(JSON.stringify(parseDate('2026-03-08')));`;
      const result = execFileSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          cwd: process.cwd(),
          env: { ...process.env, TZ: timezone },
          encoding: "utf8",
        },
      );
      expect(JSON.parse(result)).toEqual({ ok: true, value: "2026-03-08" });
    },
  );
});
