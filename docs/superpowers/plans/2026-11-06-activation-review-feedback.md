# Activation review feedback

Status: implemented and verified on November 6, 2026.

The user reported eight problems during the Slice 3 manual review. Keep this record with the [manual workflow](../../slice-3-demo.md).

| Feedback | Change |
| --- | --- |
| Category IDs are unclear | Generate IDs; keep category names and groups separate. Preserve IDs in old reviews. |
| Fixing a typo is difficult | Show questions with saved answers. Keep restart and back. Offer JSON editing at the summary. |
| Card payment reserve is unclear | Explain that it is cash set aside to pay one Credit account, separate from card debt. |
| Deficit acknowledgement is unclear | Explain the starting shortfall and that acknowledgement adds no money. |
| Reviewed Assigned is unclear | Explain the net monthly amount moved into an envelope, with an opening/assignment/spending example. |
| Evidence requests are unclear | Explain check notes and examples. Do not imply that a note attaches a file or verifies an unchecked value. Print the opening equation. |
| Interactive instructions are weak | Add an introduction and question-specific help with valid input formats. |
| Save needs Yes / No / Edit | Yes completes the review; No keeps an unfinished draft; Edit opens private facts/coverage JSON in Vim and returns to the summary. Activation still needs preview and explicit commit. |

## Implementation constraints

- JSON editing cannot change review identity, target binding, revisions, or preview metadata.
- Invalid edits and Vim cancellation preserve saved choices. Amounts in JSON are integer cents.
- Draft edits survive No and later resume. Old review files without a draft remain readable.
- Save the date used for raw question answers. Replay at that date before adding later months. Ask for the original date when an old unfinished review does not contain one; do not guess answer positions.
- No exits normally with an unfinished draft. Quit preserves progress. Abandon clears all review answers and cancels without changing the database.

## Verification

The Vim-to-activation terminal workflow passed with a temporary synthetic database. It covers editing a category name, No, resume, Yes, preview, explicit commit, and a report with the corrected name. Separate Vim save and cancellation checks passed.

`npm run check` passed all 1,007 tests in 86 files, plus document, private-path, boundary, format, lint, type, secret, and build checks. Review found no remaining actionable issue. Real terminal checks confirmed that quit preserves answers, abandon clears them, and the next review starts blank without changing the database. The user completed the synthetic manual demo on November 10, 2026. See the [closeout record](2026-11-10-slice-3-closeout.md) for subsequent changes and final publication checks. Household activation remains separate.
