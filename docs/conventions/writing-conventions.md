# Writing conventions

Status: required implementation standard.

A convention is a working rule for people and agents in this repository. Product behavior stays in the requirements. Access and data rules stay in the architecture. A convention says how to do the work here.

## Where a convention lives

Put each convention in `docs/conventions/`. Use one file for one topic. Use a short file name that says the topic, such as `private-pages.md`.

## How to write one

- Use plain language. Do not use opaque labels.
- Start with a title and a status line.
- State the rule, then the steps that follow it.
- Link to the requirements or the architecture when those documents own the rule. Do not copy that rule into a second authority.
- Keep the file short. Add an example only when the rule is easier to miss without one.

## What to update

When you add, rename, or remove a convention, update both lists in the same change:

1. `README.md`, under Conventions.
2. `AGENTS.md`, under Project context, in the `docs/conventions/` list.

Use the same order and the same short description in both lists. The link path has one slash: `docs/conventions/<file>.md`.

If an agent must read the convention before a kind of work, add one bullet under Working practices in `AGENTS.md`. Name the file and the work.

`docs/README.md` is the product and design index. Do not add coding conventions there.

## Check

Before the change is done, both lists include the convention, and the two lists match.
