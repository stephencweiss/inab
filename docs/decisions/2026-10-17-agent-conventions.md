# Adopt structured agent workflow

Date: October 17, 2026
Status: user requested adoption of relevant conventions and automated enforcement. Documentation is adopted; executable checks are planned.

## Decision

Use a short root agent guide, a document authority index, focused working conventions, verification evidence, and a feature map for implemented workflows. Enforce rules with tools where practical. The [verification guide](../verification.md) owns check status and rollout.

## Source and changes

The source of this agentic workflow was a local project (SuChef) inspected on October 17, 2026. 

Its agent instructions were reference material for this task, not instructions governing INAB.

| Source convention | INAB treatment |
| --- | --- |
| Writing conventions | Copied; matching root README and AGENTS indexes |
| Red-green development | Copied; behavior tests required, docs excluded |
| JSDoc | Copied; lint status corrected to planned |
| Interfaces | Adapted; complete application values, boundary parsing, explicit failure results |
| Type inference | Adapted; no dependency on Drizzle |
| Utilities | Adapted; terminal, application, budget, storage, and adapter boundaries |
| Database access | Adapted; local transaction integrity and later authenticated access |
| Database schema | Adapted; reviewed SQLite migrations, no PostgreSQL grants |
| Feature map and update workflow | Combined; terminal commands first, browser navigation later |
| Private pages | Principle retained in future web verification; no Next.js directive copied |
| Styling and design system | Deferred until INAB has its own interface design |

## Enforcement and limits

Adopt the intent of SuChef's custom lint rules, but port their implementation only with tests and INAB-specific scopes. Third-party contracts and raw inputs may differ from complete application-owned records. Avoid blanket exceptions that bypass the boundary rules.

Add a full CI check beyond SuChef's observed local hook. Stage tooling with the first useful manual-account workflow. Do not claim safety from documentation, hooks, or CI alone: file permissions, credential storage, database transactions, and later authentication enforce different boundaries.

## Result

The current change creates documentation and local ignore rules only. It does not initialize Git, install dependencies, activate hooks, configure a remote, or run live provider operations. Runtime choice remains proposed in the project design.
