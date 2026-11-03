# Explicit interfaces

Status: required implementation standard. The scoped interface lint rules and their policy tests are active. Import boundary checks are active.

Application-owned values have all required fields. Use `null` for an absent value. Use a tagged union when states have different fields. Do not use optional properties or `undefined` to hide a missing decision.

Parse external input once at its boundary. CSV, provider JSON, terminal arguments, and later web requests are untrusted data. Parsers return either a validated value or structured errors. Budget functions accept validated values, not raw provider responses or `unknown`.

Expected failures use explicit results, such as `{ ok: false, reason: "duplicate-import" }`. Unexpected storage failures still stop and roll back the operation.

Do not change external SDK contracts to make them resemble ours. Normalize them in an adapter. Preserve the difference between an omitted update and an explicit clear operation. A parser may use optional input fields; its validated output must describe the intended operation explicitly. The optional-property rule allows `?` only on a raw input type in `src/adapters/`. That type name starts with `Raw` or `Unparsed`, or ends with `Input`. `?: never` remains available in a tagged union.

Add factories only when callers need them. Keep each factory beside its owned type. Do not use casts to bypass validation.

The installed `inab` rules reject optional properties and `undefined` in types. They reject direct and nested `unknown` parameter annotations outside a `parse` or `validate` function or the checked parameter of a type guard. Raw input exceptions stop at function boundaries; validated method outputs must remain complete. The unknown rule checks written annotations; it does not resolve type aliases. A function name does not prove that the function validates its input. Import boundary checks are active; parser tests remain planned. Form data and shared helpers use the same scoped rules.
