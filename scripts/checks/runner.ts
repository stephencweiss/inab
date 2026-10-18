export const CHECKS = [
  "check:documents",
  "check:tracked",
  "check:boundaries",
  "check:format",
  "lint",
  "typecheck",
  "test",
  "check:secrets",
  "build",
] as const;

export function runChecks(run: (name: string) => number): number {
  for (const name of CHECKS) {
    const status = run(name);
    if (status !== 0) return status;
  }
  return 0;
}
