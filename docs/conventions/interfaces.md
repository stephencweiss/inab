# Explicit interfaces

Status: required implementation standard; automated enforcement is planned.

Adapted from SuChef's interfaces convention.

Application-owned values have all required fields. Use `null` for an absent value. Use a tagged union when states have different fields. Do not use optional properties or `undefined` to hide a missing decision.

Parse external input once at its boundary. CSV, provider JSON, terminal arguments, and later web requests are untrusted data. Parsers return either a validated value or structured errors. Budget functions accept validated values, not raw provider responses or `unknown`.

Expected failures use explicit results, such as `{ ok: false, reason: "duplicate-import" }`. Unexpected storage failures still stop and roll back the operation.

Do not change external SDK contracts to make them resemble ours. Normalize them in an adapter. Preserve the difference between an omitted update and an explicit clear operation. A parser may use optional input fields; its validated output must describe the intended operation explicitly.

Add factories only when callers need them. Keep each factory beside its owned type. Do not use casts to bypass validation.

Planned enforcement: lint rules for application-owned contracts, boundary import checks, and parser tests. Review the SuChef custom rule and its tests before porting it. Its name-based parser exceptions alone do not prove that validation occurs.
