# Type inference

Status: required implementation standard. Strict TypeScript, redundant-type checks, and unnecessary assertion checks and their policy tests are active.

Let TypeScript infer local values and callback parameters. Write types for public contracts, function parameters, empty collections, and values that need a wider type. Do not repeat an inferred union or use a type predicate when a boolean check is enough.

Prefer a parser or guard over a cast. A cast must have a reason that the surrounding code or a short JSDoc block makes clear. Do not use `any` or double assertions to avoid a type error.

Derive stored rows from the Drizzle table with `$inferSelect` and accepted insert shapes with `$inferInsert`. Put needed exported types beside their table. Do not copy columns into handwritten interfaces. Preserve the inferred shape of partial query selections. Keep validated commands and display models separate from stored rows. Validate raw inputs and raw SQL results at their boundary; inferred query types do not prove runtime data validity.

The redundant-type rule is installed with valid and invalid cases. It reports an annotation that copies an inferred type, a redundant callback parameter type, and a type predicate on an unnamed callback.
