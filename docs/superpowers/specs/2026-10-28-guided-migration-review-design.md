# Guided migration review

Status: approved for implementation on October 29, 2026, including interactive and script mode rules. This changes terminal guidance, not migration accounting rules.

## Problem

The terminal review prints a JSON object and asks for an action and an internal key. It does not explain the required sequence. Prompts hide accepted values, and invalid input ends the session.

## Guided flow

Use a guided sequence as the default interactive review. Keep explicit commands and JSON inspection available for scripts. A menu with better labels would still require users to understand the action sequence; a separate web interface would extend this task beyond the terminal workflow.

1. Explain that review prepares migration choices in a private file. Show the database and review paths. No household records are written until import confirmation.
2. Walk through source accounts by name and show progress, such as `Account 1 of 2: Demo cash`. Ask for the local name, account kind, and closed state. Select the source key internally. Show saved choices when resuming; offer to keep or edit them.
3. For each Cash or Credit account, ask for its opening closing-balance date and signed USD balance. Explain that credit debt is negative. Explain history-only versus active pending/posted entries before asking how history should be handled. Preserve the existing history-only default only with explicit coverage acknowledgement. Never infer bank posting dates from source clearing labels.
4. Show remaining issues in plain language with account names and relevant source-row details. Offer actions that apply to that issue. Let users select numbered rows with date, payee, and amount instead of copying internal keys. Tracking evidence, observation selection, and adjustment resolution remain explicit choices. Do not create observations or revise amounts automatically. Where external evidence is required, explain what is missing and allow the user to save and leave.
5. Show a readable summary of accounts, openings, source/history/live counts, unresolved blockers, warnings, and Tracking differences. When ready, offer import confirmation or save and exit. Before import, explain that it completes setup and closes further imports. Use the existing revision checks and confirmation path.

## Interactive and script modes

Support two ways to use migration review: a guided terminal session and explicit commands for scripts.

| Invocation | Behavior |
| --- | --- |
| `setup migrate review --review PATH --interactive` | Start the guided sequence. Require a terminal. |
| `setup migrate review --review PATH -i` | Alias for `--interactive`. |
| `setup migrate review --review PATH` in a terminal | Start the guided sequence by default. |
| `setup migrate review --review PATH --json` | Return structured review data without prompts, even in a terminal. |
| Explicit migration change commands with complete arguments | Support script use without prompts; retain `--json` for structured output. |

All examples also require the existing `--db` argument. Scripted changes continue to use commands such as `setup migrate account ACCOUNT_KEY --review PATH --expected-review N --name NAME --kind cash --closed no`.

Reject `--interactive --json` and `-i --json` together with a clear error. If interactive mode is requested without a terminal, fail before asking questions or writing changes. Without a terminal, never wait for input; incomplete commands fail with a message that identifies the required arguments. The interactive flag does not bypass input validation, revision checks, or import confirmation.

## Prompt rules

- Show required review steps and separate warning counts before the first question. Group duplicate mapping blockers by source account; show conditional Cash/Credit opening steps before account kinds are known. State that counts can change as choices reveal more issues. After each saved choice, show addressed and remaining steps with correct singular/plural wording.
- Separate sections with blank lines and put their headings first. Prefix action questions with `--> `. Put explanations above the action question. The History menu uses `Action ([h]istory, [e]dit, [s]ave, [a]bandon, help): ` and explains the difference between keeping and acknowledging current history choices, editing source rows, and returning to the summary without a new acknowledgement.

- Every migration decision offers help and `[a]bandon`. Most prompts use `[h]elp`; the History action menu uses `[h]istory` and the full word `help`. `h` / `help` shows the relevant shared [term definition](../../term-dictionary.md), then repeats the identical question without changing its default, answer, saved choices, or database. Definitions are included in the built CLI for offline use; a test keeps the readable dictionary in sync. Help explains that the date default is today's local date, not source evidence. Opening prompts give guidance specific to the chosen account kind.
- Nested review menus offer `[b]ack` to return to their parent without saving an unfinished choice. Evidence returns to the summary; Observations returns to Evidence. Row, account, warning, and observation selectors return to their parent menu. Initial guided questions and free-text/date/amount fields do not offer Back. Abandon leaves the session, keeps confirmed choices, and explains how to resume with the same command.
- Letters and full command words ignore case. A unique enum initial can select that value; ambiguous initials repeat the question. `h` is reserved for help except in the History action menu, where it selects history and help must be entered in full. `a` is reserved for abandon. Existing full-word `cancel` remains a compatibility alias. Final import still needs an explicit yes, with no default.

- Before each save, display the full proposed choice in readable fields. For an account, show its source account position, proposed name, kind, and closed state. Other choices show their proposed opening, row, observation, resolution, or acknowledgement values. Use `Save this review choice? ([Y]es (default), [N]o, [h]elp, [A]bandon): `. Enter saves; letters and full words ignore case. No rejects the current choice; abandon leaves while preserving prior saved choices. Final import confirmation remains explicit and has no default yes.

- Start with `Start migration review ([c]ontinue (default), [d]one, [h]elp, [a]bandon): `. Enter selects continue. Accept each displayed letter or full word, ignoring case. Done leaves normally; abandon cancels the current session while preserving saved choices. The existing full-word `cancel` also remains accepted.

- List each accepted choice at the prompt. Introduce account kind with `next up: account kind. Please pick between:` and short meanings. Its prompt lists `cash`, `credit`, `tracking`, or `abandon`; abandon leaves the session while preserving previously saved choices. Closed state: `Is this account closed? ([n]o (default), [y]es, [h]elp, [a]bandon): `. Enter selects no. Accept displayed letters or full words, ignoring case; abandon preserves saved choices.
- Explain enum choices for row treatment, row role, and adjustment resolution. Give `YYYY-MM-DD` for dates and signed USD examples for amounts.
- Invalid interactive input shows the accepted values and repeats the current question. Keep earlier confirmed choices. Cancellation saves no partial current change and preserves previously saved choices.
- Show a separate progress summary after each confirmed change. Use readable text for normal interactive output; retain JSON through `--json`.
- Saved choices determine resume progress. Do not silently change existing mappings, history treatment, observations, or acknowledgements.
- Import remains blocked when the existing application checks reject the review. Do not treat guidance or acknowledgement as a replacement for evidence.

## Implementation boundaries

Keep prompt presentation and step selection in focused CLI modules. Reuse application inspect/change/commit operations and their derived issues. No schema, review-file schema, or account arithmetic changes are required. Keep explicit noninteractive command arguments compatible. Add mode parsing and terminal checks at the CLI boundary; script callers must not enter the guided sequence.

## Verification

Write failing terminal tests before changing behavior.
Tests cover:

- `--interactive` and `-i`,
- automatic terminal guidance,
- prompt-free JSON inspection,
- conflicting mode flags,
- refusal of interactive mode without a terminal,
- incomplete script arguments,
- complete scripted changes,
- listed choices,
- invalid-input retry,
- account selection without copied keys,
- progress across multiple accounts,
- resumed choices,
- opening guidance,
- explicit history acknowledgement,
- relevant issue actions,
- Tracking review,
- save/exit,
- cancellation,
- and final confirmation without premature writes.

Run relevant CLI tests, the synthetic demo, types, lint, document and boundary checks. Update the manual guide and affected feature-map steps with exact prompt answers.

## Visible shortcuts and existing text

Every menu displays a bracketed first letter when it is unique in that menu and is not reserved for help or abandon. Ambiguous first letters require the full word. Numeric selectors stay numeric. The History action menu keeps its explicit history/help distinction. Manual account-kind prompts use the same rules as migration prompts. CLI subcommands and script flags keep their current spelling.

When a text field has a current value, show it and offer `[c]onfirm` or replacement text. For Account name, use `Account name: current value is [Demo cash]. [c]onfirm or type new name; or [h]elp, or [a]bandon: `. Confirm and c ignore case and keep that value; Enter also keeps it for compatibility. Other text replaces it. Without a current value, c is ordinary input. Dates, money, IDs, and file paths keep their input formats. Saving remains a separate confirmation.

Saved mapping and opening menus show `[k]eep (default), [e]dit, [h]elp, [a]bandon`. Enter keeps saved values without a new save or revision. Letters and full words ignore case. Help and invalid input keep the same default. Final write and import confirmations still require explicit approval.

When required issues remain, the summary offers `[r]eview (default), [s]ave, [h]elp, [a]bandon`. Enter opens evidence review without saving a choice or importing records. A complete review has no default action; import still needs separate explicit confirmation.

## Explain issue outcomes

Warnings and blockers show readable names. Selecting one states what is missing or conflicting, its effect, and the required action. History acknowledgement accepts an export limit; it does not verify completeness. Split-parent uncertainty is an informational export limit, does not assert that splits exist, and does not block import. A nonblocking warning must not be called an unresolved blocker.

A posting on or before the Cash/Credit opening date conflicts with that opening balance. Show both dates and the risk of counting the transaction twice. Explain history treatment for rows covered by the opening balance, or correction of opening/posting values with bank evidence. Never suggest moving a date merely to pass validation.

The terminal shows a repeated account-level posting diagnostic only when no matching row diagnostic is available. Keep all raw validation checks, JSON, reports, and commit rules. Use the same visible issue list for summary, numbered selection, and required-step counts. After each confirmed saved change, state which blockers cleared, which acknowledgements were accepted with a warning remaining, and which new blockers appeared. A rejected or unchanged choice must not show a resolved issue.

## Migration orientation and terminal welcome

Before the first interactive review question, explain the normal path in three steps: keep YNAB transactions as inspectable history; confirm starting posted balances for Cash/Credit on a chosen date; use INAB for later activity. Historical rows do not change active balances. Plan history is retained for inspection. Promotion of imported rows is optional. Pending activity does not change posted balances, and Tracking uses reviewed observations/adjustments. Reinforce this path in the opening and History sections. Keep import as a separate confirmation.

Terminal CLI launches display the user-provided slanted INAB ASCII banner once, including terminal help. Use cyan artwork, a bold INAB CLI label, the current version in green, and a dim household budgeting description. Share the version with --version; do not copy the example network-analysis description or example version. Send it to stderr and omit it for noninteractive runs, JSON output, and version output. Do not change command flags, scripted output, database behavior, or migration decisions.

Reopening an already imported review in text mode prints exactly `Migration completed` and exits successfully without prompts or writes. Recognize completion only through a matching stored import receipt, including target identity and review revision. A changed/replaced target must still fail; source files need not remain after completion. JSON inspection and commit retries keep their existing contracts.
