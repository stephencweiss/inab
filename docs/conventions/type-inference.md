# Type inference

Status: required implementation standard; automated enforcement is planned.

Adapted from SuChef's type inference convention.

Let TypeScript infer local values and callback parameters. Write types for public contracts, function parameters, empty collections, and values that need a wider type. Do not repeat an inferred union or use a type predicate when a boolean check is enough.

Prefer a parser or guard over a cast. A cast must have a reason that the surrounding code or a short JSDoc block makes clear. Do not use `any` or double assertions to avoid a type error.

Define a stored row shape once at the storage boundary. If the selected database library supports schema-derived types, use them. No ORM is selected yet; this convention does not select Drizzle. Keep validated commands and display models separate from stored rows.

Planned enforcement: strict TypeScript, unnecessary assertion checks, and redundant type checks. Port custom SuChef inference rules only with their valid and invalid test cases.
