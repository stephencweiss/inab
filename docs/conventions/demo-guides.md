# Demo guides

Status: required implementation standard.

Start each demo guide with a short explanation before setup steps or commands. A reader must understand the goal and the checks before they run the demo.

## Explain the purpose

The opening must explain:

- What the feature lets the user do, and how it builds on earlier work.
- What scenario the demo follows, including its starting state and main actions.
- What behavior and results we want to check, and why they matter.
- Any terms needed to understand the scenario.

Use plain language. Keep command syntax and implementation details in the steps that follow. Link to the owning design or rules when more detail is needed.

## Explain how to review

If the guide has automated and manual paths, explain what each covers, which to run, and why their expected results differ. Identify reference sections that are not steps in the main walkthrough.

State what a successful review looks like. Include expected values or visible results with the relevant steps. End with a checklist of the behavior and user experience the reader must check. Explain what feedback to report. Keep automated check results separate from manual review status.

Use the [Slice 3 demo opening](../slice-3-demo.md#what-we-want-to-check) as an example. Apply this convention when creating or revising demo guides. Follow the [feature map convention](feature-map.md) for runnable commands, synthetic fixtures, and workflow verification.
