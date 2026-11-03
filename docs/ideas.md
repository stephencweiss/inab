# Ideas

Status: proposals only. These ideas are not accepted requirements or installed checks.

Use this file to collect possible improvements. Record the problem, proposed change, current limits, and source. When an idea is accepted, update the owning design or decision and write an implementation plan. The [verification guide](verification.md) records which checks are active.

The ideas below came from review of the [local quality gates plan](superpowers/plans/2026-10-18-local-quality-gates.md).

## Command completeness

Status: proposed.

Add a policy test that compares an owned command/action list with success and applicable refusal cases in executable CLI or workflow tests. The existing feature map verifies its listed commands; it does not prove that every supported command has an entry. Lint alone cannot prove behavior coverage.

Source: [command coverage review comment](https://github.com/stephencweiss/inab/pull/2#discussion_r4315408063).

## CI enforcement

Status: proposed.

Add workflow policy tests for permissions, secret exposure, and artifact steps. Check that tracked source files stay unchanged after the suite.

Existing read-only permissions, synthetic fixture guards, and path/secret scans enforce parts of the policy. Tests and builds still need temporary databases and generated files. A source-change check detects writes; stronger prevention of private reads, filesystem writes, or network access requires runner isolation.

Source: [CI enforcement review comment](https://github.com/stephencweiss/inab/pull/2#discussion_r4315425699).
