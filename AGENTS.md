# Project Instructions

This repository contains the `local-tester-mcp` server used by the `local-test-verdict` skill. It runs validation commands in a target workspace, stores full logs locally, and asks a local OpenAI-compatible LLM endpoint for compact verdicts, failure triage, changed-file review, and regression checks.

## Required Checks

- Always check this file before making changes. If a nested `AGENTS.md` or `agents.md` exists, follow the most local applicable file as well.
- Keep changes focused on the MCP server, its tool contracts, or the skill documentation that describes those contracts.
- Run `npm run build` after TypeScript changes.
- Do not run `npm install` in the sandbox. Any dependency installation must be requested with network privileges.
- If you change server behavior, tool names, input schemas, output shapes, environment variables, validation logic, command detection, log paths, setup requirements, or guardrails, update `README.md` and `skill/skill-example.md` in the same change.
- Do not modify generated test-run logs or baseline files unless the task explicitly requires it.

## Repository Shape

- `src/index.ts`: MCP server setup, tool registration, request handlers, and output shaping.
- `src/runner.ts`: command execution, timeout handling, raw log persistence, and log trimming.
- `src/detector.ts`: automatic validation command detection for supported project types.
- `src/llm.ts`: local LLM prompts, OpenAI-compatible API calls, JSON extraction, and fallback behavior.
- `src/types.ts`: shared TypeScript contracts for tool arguments and verdict payloads.
- `README.md`: user-facing setup, tool descriptions, configuration, and troubleshooting instructions. This must stay aligned with server behavior.
- `skill/skill-example.md`: skill-facing usage instructions. This must stay aligned with server behavior.

## MCP Tool Contract

Preserve the current tools unless the user explicitly asks for a contract change:

- `run_test_verdict`: runs explicit or auto-detected commands and returns a JSON verdict.
- `run_failure_triage`: analyzes an existing log file.
- `run_changed_files_review`: reviews small changed files before expensive validation.
- `run_regression_check`: compares current auto-detected command results with `.codex-local-test-runs/baseline.json` and then writes the current run as the new baseline.

When changing a tool:

- Update the `ListToolsRequestSchema` entry and the handler together.
- Keep returned JSON stable and easy for agents to parse.
- Treat non-zero command exit codes as authoritative failures. The local LLM may summarize or classify, but it must not override command truth.
- Prefer adding optional fields over changing or removing existing fields.
- Resolve user-provided workspace-relative paths under `workspacePath` and avoid reading outside the intended workspace.
- Keep raw logs out of conversational output when a compact verdict or triage summary is actionable.

## Local LLM Behavior

- The server uses `LOCAL_LLM_API_URL` and `LOCAL_LLM_MODEL`, defaulting to `http://localhost:8080/v1` and `local-model`.
- Keep prompts strict about JSON-only responses.
- Keep fallback behavior conservative. If the model is offline, returns invalid JSON, or cannot classify the result, return `uncertain` or an advisory review issue instead of pretending confidence.
- Do not add remote hosted LLM dependencies or external network calls unless the user explicitly requests that architecture change.

## Command Execution and Logs

- Commands run with `child_process.exec` in the target workspace.
- Full logs are written under `.codex-local-test-runs/` in the target workspace.
- Log trimming should preserve enough beginning and ending context for LLM triage.
- Timeouts, buffer limits, and shell execution behavior are part of the server safety model. Change them deliberately and document the impact.
- Be careful with command detection. Auto-detected commands should be deterministic validation commands such as build, typecheck, lint, and tests.

## Code Style

- Use TypeScript and the project’s existing module style.
- Keep code small and explicit. This project is a tool server, so predictable contracts are more important than clever abstractions.
- Add multi-line block comments (`/* ... */`) at the top of large added or modified code sections when the logic is not immediately obvious. Keep those comments short and factual.
- Do not replace a needed block comment with several `//` comments.
- Prefer structured parsing and typed objects over ad hoc string handling when practical.
- Avoid broad refactors unless they directly reduce risk or are necessary for the requested change.

## Verification

For TypeScript or behavior changes:

1. Run `npm run build`.
2. If a tool behavior changed, exercise the relevant path with the narrowest practical local command or fixture.
3. Confirm `README.md` and `skill/skill-example.md` describe the new behavior.

For documentation-only changes:

1. Check that the instructions do not contradict `README.md` or `skill/skill-example.md`.
2. No build is required unless code changed.

## Reporting Back

Summaries should include:

- What changed.
- Why the change was necessary.
- What verification was run, or why verification was not needed.
- Any remaining risk, especially around local LLM availability, command detection, or baseline mutation.
