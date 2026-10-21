# Adopt structured agent workflow

Date: October 17, 2026
Status: accepted.

## Decision

Use a short root agent guide, a document authority index, focused working conventions, verification evidence, and a feature map for implemented workflows. Enforce rules with tools where practical. The [verification guide](../verification.md) owns check status and rollout.

## Scope

| Convention | INAB rule |
| --- | --- |
| Writing conventions | Keep matching root README and AGENTS indexes |
| Red-green development | Test executable behavior before implementation; documentation is excluded |
| JSDoc | Document constraints without repeating names and types |
| Interfaces | Define complete application values, parse boundaries, and return explicit failure results |
| Type inference | Infer local values and derive stored row types from the schema |
| Utilities | Separate terminal, application, account, budget, storage, and adapter modules |
| Database access | Preserve local transaction integrity; add authenticated access at the web boundary |
| Database schema | Review SQLite migrations and verify recovery |
| Feature map | Record working terminal commands first; add browser navigation with the web interface |
| Private pages | Require authentication before private web responses |
| Styling and design system | Define these when INAB has a web interface |

## Enforcement and limits

Use focused custom lint rules with tests and INAB-specific scopes. Third-party contracts and raw inputs may differ from complete application-owned records. Avoid blanket exceptions that bypass boundary rules.

Run the full check in CI. Stage tooling with the first useful manual-account workflow. Documentation, hooks, and CI are not security boundaries: file permissions, credential storage, database transactions, and later authentication enforce different rules.

The lint setup names every Sonar recommended rule, sets cognitive complexity to 15, and sets ESLint complexity to 20. Custom rules cover JSDoc comments, explicit interfaces, redundant types, and TypeScript source files. Form data and shared helpers use the same scoped rules.

`npm run check` is the common local and CI entry point. The verification guide records its current stages, active checks, and enforcement limits.
