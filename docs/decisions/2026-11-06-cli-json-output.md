# Terminal JSON formatting

Date: November 6, 2026.
Status: accepted by the user.

For `--json` output, use two-space indentation when the destination stream is a terminal. Use compact JSON when the stream is a pipe or redirected file. Check Node.js `process.stdout.isTTY` for results and `process.stderr.isTTY` for JSON errors. The two streams can be redirected independently.

Keep the data, exit status, output stream, and trailing newline unchanged. Existing human output keeps its current form. The standalone migration command uses the same rule for its JSON result. Formatting belongs in the shared terminal JSON helper, outside application and financial rules.

CLI tests exercise terminal output, pipe output, direct file redirection, and JSON errors with opposite stdout/stderr terminal states. The [verification guide](../verification.md) records current checks.
