# JSDoc

Status: required implementation standard.

A function does not need a JSDoc block. The name, the TypeScript signature, and the tests are the documentation. Add a block only when those three leave out something a caller must not miss.

## Write a block when

Write a short `/** ... */` block when a caller can misuse the function from its signature alone:

- A security or access rule the types do not state. `sanitizeReturnUrl` takes strings, and the block is what says `//evil.com`, `javascript:`, and path traversal are rejected.
- A side effect or failure result that is easy to miss.
- A constraint on the whole file. The demo-scenario header says those fixtures exist only in local demo mode and are not real user records.

Put the block on the function, or once at the top of the file when the constraint applies to everything in that file. State the constraint. Leave out a restatement of the function name and `@param` tags that repeat the TypeScript types.

## Skip a block when

Skip it when the name and types already say what the function does. `isRecord` and `requireString` need no block. A comment such as "Pure guard checking if session has customer role" on `requireCustomer` only repeats the name, so do not add comments in that shape.

## Comment form

In `src/`, comments follow this format rule. `only-jsdoc/only-jsdoc-comments` enforces it. A comment is a JSDoc block. A line comment stays only when it starts with `approved:` and a reason. Tests are exempt from that lint rule. This convention still applies to test helpers: document a non-obvious constraint, and skip a comment that restates the name.
