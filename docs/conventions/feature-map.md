# Feature map

Status: required implementation standard; map and automated checks start with the first working workflow.

Maintain one hand-edited map at `docs/agent/feature_map.json`. Record implemented user goals, not planned features or helper functions. Do not create the map until a workflow exists.

For each terminal workflow, record a stable ID, a plain-language name, fixture prerequisites, exact commands and prompt answers, relevant source files, expected exit status, and visible success and failure signals. Commands must use a temporary database and synthetic data. Never put account details or credentials in the map.

Later, add web navigation and stable accessible selectors for the same user goals. The map must distinguish terminal and web steps without duplicating product rules.

When behavior changes, update the product and its map entry together. Verify the JSON structure, IDs, referenced files, and execution of the documented workflow. Captured command or browser output is evidence; it must not overwrite the map.

Do not weaken tests or remove failure cases to make a stale entry pass. Formatting-only changes need no map edit when the workflow is unchanged.
