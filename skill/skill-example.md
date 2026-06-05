---
name: local-test-verdict
description: Use the local tester MCP server and its local LLM triage flow to validate code changes, review changed files, triage failures, check regressions, classify command output, and keep raw logs out of context. Trigger after implementing code changes, fixing bugs, touching tests/build/lint behavior, preparing final verification, triaging failures, reviewing changed files, checking regressions, or when the user asks to use the local tester, run_test_verdict, local LLM test triage, or avoid reading raw logs.
---

# Local Test Verdict

## Overview

Use the `mcp__local_tester` tools as the first validation path after code changes. Let the MCP server run validation commands, persist full logs under the target workspace, and ask the local LLM for compact verdicts, changed-file review, failure triage, or regression checks before deciding whether raw logs are needed.

Currently implemented server tools:

- `run_test_verdict`: runs build/lint/test/smoke commands in a workspace and returns a compact local-LLM verdict.
- `run_failure_triage`: analyzes an existing log file and returns compact root-cause/fix guidance.
- `run_changed_files_review`: reads changed files under 500 KB and asks the local LLM for likely issues before expensive validation.
- `run_regression_check`: runs auto-detected commands, compares success state with `.codex-local-test-runs/baseline.json`, writes the current run as the new baseline, and returns whether a regression was detected.

## Workflow

1. Check local project instructions before validation, including `AGENTS.md` or `agents.md`.
2. Identify the workspace path as an absolute path.
3. If files changed and the tool is exposed, call `run_changed_files_review` before slow test suites when a lightweight local-LLM review can catch obvious issues.
4. Prefer an explicit `testCommand` for `run_test_verdict` when the correct validation command is known from the repo, package scripts, or user request.
5. Omit `testCommand` only when automatic command detection is preferable.
6. Pass a short `taskSummary` that describes the concrete code change or validation goal, not a broad audit request.
7. Pass `changedFiles` when available, using repo-relative paths for tools that resolve files under `workspacePath`.
8. Treat returned JSON as the primary signal and avoid raw logs while the summary is actionable.
9. When `verdict` is `fail` or `uncertain`, prefer `run_failure_triage` on the returned log file before reading raw logs, unless the returned summary already contains enough detail to fix the issue.
10. Use `run_regression_check` only when auto-detected commands are appropriate and updating `.codex-local-test-runs/baseline.json` is acceptable for the workspace.

## Tool Call Shapes

Call `run_changed_files_review`:

```json
{
  "workspacePath": "/absolute/path/to/workspace",
  "changedFiles": ["src/example.ts"]
}
```

Call `run_test_verdict`:

```json
{
  "workspacePath": "/absolute/path/to/workspace",
  "taskSummary": "Implemented X; validate build/lint/tests for that change.",
  "changedFiles": ["src/example.ts"],
  "testCommand": "npm test"
}
```

Call `run_failure_triage` only for an existing log path, usually after `run_test_verdict` returns a `rawLogPath`:

```json
{
  "logPath": "/absolute/path/to/workspace/.codex-local-test-runs/example.log"
}
```

If `rawLogPath` is relative, resolve it against `workspacePath` before calling `run_failure_triage`.

Call `run_regression_check` only when the project has a meaningful auto-detected test/build command and baseline mutation is intended:

```json
{
  "workspacePath": "/absolute/path/to/workspace"
}
```

Use commands that exercise the changed surface:

- Narrow change: run the most specific relevant test, lint target, typecheck, or build.
- Shared behavior or uncertain scope: run the broader suite after the narrow check.
- No test suite: run the best deterministic command available, such as typecheck, build, or a small executable probe.

## Interpreting Results

- `run_changed_files_review`: Treat `hasIssues: true` as advisory. Verify serious findings with tests, typecheck, or direct code inspection before changing code.
- `run_test_verdict` `pass`: Report the commands run, the verdict, and any residual risk. Do not read or paste raw logs.
- `run_test_verdict` `fail`: Use the LLM summary and `failures` first. If the fix is not clear, call `run_failure_triage` with the log path before opening raw logs.
- `run_test_verdict` `uncertain`: Call `run_failure_triage` with the referenced log path. Inspect the raw log file only if triage is missing, vague, contradictory, or not enough for the next debugging step.
- `run_regression_check`: Treat `isRegression: true` as a signal that the current run failed after a previously successful baseline. Remember the tool overwrites the baseline with the current run.

The server writes `rawLogPath` relative to `workspacePath`, usually inside `.codex-local-test-runs/`.

## Additional LLM Use Cases

Use `run_test_verdict` for any validation command where a compact local-LLM summary is more useful than raw output:

- Build, lint, typecheck, unit test, integration test, browser test, and smoke-check verdicts.
- One-off executable probes, such as a small Node/Python command that confirms a fixed behavior.
- Dependency or environment checks where the model can classify whether a failure is code-related, setup-related, or inconclusive.
- Final verification summaries before responding to the user, especially after multi-file changes.

Use `run_changed_files_review` for quick local-LLM review when changed files are small enough to fit the tool limit:

- Catch obvious syntax, type, logic, or regression risks before running slow suites.
- Review generated or repetitive edits where simple mistakes are easy to miss.
- Surface suspicious files that deserve focused tests or manual inspection.

Use `run_failure_triage` for follow-up analysis of existing logs:

- A failed or uncertain verdict needs stack-trace classification.
- The summary identifies symptoms but not the likely root cause.
- A long build, lint, or browser-test log needs compact failure grouping.
- The same command was retried and you need to distinguish deterministic failure from environment noise.

Use `run_regression_check` for baseline-aware checks only when baseline churn is acceptable:

- Establish the first baseline for a workspace after a known-good run.
- Detect whether a newly failing auto-detected suite regressed from a previously successful baseline.
- Avoid it when you need a read-only check, a custom command, or stable historical baselines.

If a tool exists in the server but is not exposed in the current Codex session, check `~/.codex/config.toml` `mcp_servers.local_tester.enabled_tools`, then restart or reload Codex so the tool surface refreshes.

## Guardrails

- Do not paste raw logs into the conversation when the verdict or triage is actionable.
- Do not let the LLM override command truth: non-zero exits are failures unless the tool explicitly reports uncertainty.
- Treat changed-file review findings as advisory because the local LLM sees file contents, not full project semantics.
- Keep `taskSummary` concrete so the local model judges the actual validation target.
- Resolve relative log paths against `workspacePath` before follow-up triage.
- Avoid `run_regression_check` when writing or replacing `.codex-local-test-runs/baseline.json` would be undesirable.
- If an MCP tool returns placeholder text, no analysis, or anything clearly non-authoritative, fall back to reading the smallest useful raw-log slice or running normal local commands.
- If the MCP tool is unavailable, fall back to local commands and summarize output manually, then tell the user the MCP validation path was unavailable.
