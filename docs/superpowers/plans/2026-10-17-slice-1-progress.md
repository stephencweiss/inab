# Slice 1 implementation progress

## October 17, 2026 — Task 1

Scope: terminal help and error dispatch, subprocess harness, exact database dependency pins, and emitting build. Account workflows remain planned. This session stops after Task 1. Existing user changes remain unstaged and uncommitted.

### Versions and compatibility

The existing Node.js 24.16.0 pin and all existing exact tool versions are retained. Node 24 is supported LTS according to the [official release schedule](https://nodejs.org/en/about/previous-releases).

| Package | Exact version | Official npm Node engine |
| --- | --- | --- |
| TypeScript | 6.0.3 | >=14.17 |
| tsx | 4.23.15 | >=18.0.0 |
| Vitest | 5.0.5 | ^22.12.0 or ^24.0.0 or >=26.0.0 |
| ESLint | 10.13.0 | ^20.19.0 or ^22.13.0 or >=24 |
| typescript-eslint | 8.71.2 | ^18.18.0 or ^20.9.0 or >=21.1.0 |
| Prettier | 3.9.10 | >=14 |
| Husky | 9.1.7 | >=18 |
| drizzle-orm | 0.45.4 | Not declared |
| drizzle-kit | 0.31.11 | Not declared |
| better-sqlite3 | 13.0.3 | >=22 |
| @types/better-sqlite3 | 9.6.0 | Not declared |

Checked exact package metadata through the [official npm registry](https://registry.npmjs.org/). ORM 0.45.4 accepts better-sqlite3 >=7 and its types. ORM and Kit use the released stable tags, not release candidates. The current online Drizzle quick start shows RC commands; those commands were not copied. An in-memory driver/ORM query returned `{ value: 1 }` on Node 24.16.0. No persistent database was created.

### Red and green evidence

- Baseline: `npm run check` passed before implementation: 8 test files, 49 tests. Document, tracked-path, format, lint, types, and secret checks passed.
- Red: `npm test -- tests/cli/help.test.ts` discovered 4 subprocess tests and failed all 4. After correcting the helper's loader resolution for an external working directory, subprocess diagnostics confirmed missing `src/cli/main.ts`; actual exit 1 differed from expected 0 or 2.
- Green: the same focused command passed all 4 tests. Help exits 0; unknown commands and flags, including an unknown flag beside `--help`, exit 2. Tests verify separate output streams and empty temporary working directories.
- `npm run lint` and `npm run typecheck` passed. Strict NodeNext, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are enabled.
- `npm run build` passed and emitted `dist/cli/main.js`. Source and built help matched byte-for-byte in an external temporary directory, with exit 0, empty stderr, and no files created.
- Independent specification and code-quality reviews approved Task 1 with no material findings.
- Final `npm run check` passed: 9 test files, 53 tests, plus document, tracked-path, format, lint, type, secret, and build checks. The full check now includes the build.

### Remaining concerns

`npm audit` reports 4 moderate development-dependency findings through `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild`. They refer to [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), which concerns the esbuild development server. The selected stable Kit still includes that dependency. No development server is started. No forced downgrade or dependency override was applied. The runtime dependency installation reported zero vulnerabilities.

Task 2 and all persistent data workflows remain open. No Task 1 commit was made because the tool baseline is existing user work.


## October 17, 2026 — Task 2

Scope: document fixtures, private-path checks, source import boundaries, and the sequential full-check runner. No account operation is added. The user accepted the four development-dependency audit findings and authorized Task 2.

- Reused the existing temporary document tests under `tests/policy/docs.test.ts`. All four cases passed before changes; no missing document behavior was claimed.
- Red: the required three-file policy command found the missing boundary checker and a staged-mode failure: a previously committed private path was incorrectly included in the staged set. With an empty boundary-check skeleton, 21 forbidden dependency cases failed as expected. Runner tests found the missing runner module.
- Additional red cases: three cross-domain imports passed incorrectly; a staged private-path type change was missed. The focused tests confirmed those failures before the fixes.
- Green: TypeScript AST and module resolution enforce domain, application, and CLI imports, including aliases, re-exports, import types, and dynamic imports. Computed imports and unresolved dependencies fail in restricted modules. Domain modules import their own directory and shared helpers only. `src/bootstrap.ts` owns composition.
- Private checks retain the default candidate scan and add explicit `--staged` and `--tracked` modes. Temporary Git fixtures verify force-staged ignored files, NUL-delimited names, generated synthetic JSON, staged type changes, and deletions. The existing secret-scanner candidate API is unchanged.
- The full runner runs every current check in order and stops with the first failure. Tests verify the failure status and that later checks do not run.
- Verification: `npm test -- tests/policy/docs.test.ts tests/policy/private-files.test.ts tests/policy/boundaries.test.ts` passed. `npm run check` passed, including document, private-path, boundary, format, lint, type, test, secret, and build checks. Final results: 12 test files and 86 tests passed. The required three-file policy command passed all 35 tests. The TypeScript runner needed broader local execution access for its IPC socket; no external service was used.

- Independent specification and code quality reviews approved Task 2 with no material findings. The lead agent also ran the full check: 12 test files and 86 tests passed, with all checks and the build passing.

Task 2 is complete. The task commit is `chore: enforce source and private-data boundaries`. Later account workflows remain open.

## October 17, 2026 — Task 3

Scope: focused contract, inference, and comment lint rules. No account operation is added. The existing rules were active before this task; they were moved into `tools/eslint-plugin-inab/` and loaded as the `inab` plugin. Existing unit tests now use the moved sources. The TypeScript-only source rule remains separate. No package change was needed.

- Inspected the matching SuChef rules and interface/comment tests. Its focused sources and package metadata contained no license notices. Existing INAB changes remain: `approved:` comments, no form-data or shared-helper exemptions, and raw input fields allowed only for named raw types in adapters.
- Red: `npm test -- tests/policy/lint-rules.test.ts` passed 18 existing-behavior cases and failed three new scope cases. The raw-input exception incorrectly reached a method's output. An `unknown[]` operation parameter was missed. A guard accepted an unrelated `unknown` parameter. An initial test-helper parser setup error for non-TypeScript files was corrected before recording this red result.
- Green: all 21 installed-configuration tests passed after the focused fixes. They also verify domain/application fields, undefined results, raw adapter inputs, complete adapter outputs, SDK contract references, parsers, row validators, guards, tagged unions, redundant annotations, standard assertion/literal checks, source/test comments, and source/tool extensions. Existing standalone unit coverage remains active.
- The unknown rule checks direct and nested written parameter annotations; it does not resolve type aliases or prove that a parser validates data. Raw-input optional-field exceptions stop at function boundaries. A guard exemption applies only to its checked parameter.
- Review red and green: an added rest-parameter case failed because the parser stores its annotation on the rest node. The rule now reads that annotation before checking the argument. Typed rest parameters and parser rest inputs remain allowed. All 23 focused policy tests pass.
- Verification: focused tests, `npm run lint`, and `npm run typecheck` passed. `npm run check` passed all document, private-path, boundary, format, lint, type, test, secret, and build checks: 13 test files and 109 tests. The runner needed broader local execution access for its IPC socket, as in Task 2.

Independent specification review passed. Code quality review found the rest-parameter gap recorded above, then approved the fix with no remaining material findings. Task 3 is complete. The task commit is `chore: enforce explicit contracts and useful comments`. Task 4 remains open.
