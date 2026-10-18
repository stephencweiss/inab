# Red-green development

Status: required implementation standard.

Humans and agents must use red-green-refactor for every change to executable
behavior.

## The cycle

1. **Red:** Write a focused test that describes the required behavior. Run it
   and confirm that it fails for the expected reason.
2. **Green:** Make the smallest change that passes the test. Run the test and
   confirm that it passes.
3. **Refactor:** Improve the code without changing its behavior. Keep the test
   passing.

Do not write behavior first and add a passing test afterward. A test that never
failed does not prove that it detects the missing behavior.

## Scope

This rule applies to new behavior, bug fixes and changes to existing behavior.
Use the smallest useful test level. Prefer a unit test for isolated logic and an
integration or end-to-end test when the behavior depends on boundaries that a
unit test cannot prove.

The rule does not require a new test for:

- documentation;
- formatting;
- generated files; or
- configuration changes that cannot affect executable behavior.

If a configuration change can affect behavior, test that behavior.

## User interfaces

User-interface behavior follows the same red-green-refactor cycle. Test what
the user can do or observe, not component internals.

Use a component or integration test for focused interactions. Use an end-to-end
test only when the behavior depends on browser or application boundaries.

Pure visual changes, such as spacing, color and typography, do not require an
automated test. Review them visually. If a visual change fixes a recurring or
high-risk defect, add an appropriate regression check.

## Completion

Run the focused test during the cycle. Before marking the change complete, run
the relevant broader test, type and lint checks for the affected area. All
relevant checks must pass.
