# INAB

A personal envelope-budgeting app for one household. Terminal first; protected family web access later.

Status: design and conventions only. No application, linter, test runner, commit hook, or CI workflow is installed yet.

Start with the [document guide](docs/README.md), [project design](docs/superpowers/specs/2026-10-17-inab-design.md), and [verification plan](docs/verification.md).

## Conventions

- [Maintain convention files and indexes](docs/conventions/writing-conventions.md)
- [Test executable behavior before implementation](docs/conventions/red-green-development.md)
- [Define explicit values and validate inputs](docs/conventions/interfaces.md)
- [Avoid redundant types and unsafe casts](docs/conventions/type-inference.md)
- [Document constraints without repeating code](docs/conventions/jsdoc.md)
- [Place helpers and enforce module boundaries](docs/conventions/utilities.md)
- [Keep database operations safe and atomic](docs/conventions/database-access-rules.md)
- [Review migrations and verify recovery](docs/conventions/database-schema.md)
- [Document and verify working user workflows](docs/conventions/feature-map.md)
- [Protect private data and bound agent work](docs/conventions/agent-safety.md)
