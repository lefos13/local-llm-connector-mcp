# local-tester-mcp

`local-tester-mcp` is an MCP server for running local validation commands and turning long build, lint, test, and smoke-check logs into compact verdicts with help from a local LLM.

It is designed for coding agents that need to verify changes without pasting raw logs into the conversation. The server runs commands in the target workspace, writes full logs to disk, sends trimmed context to a local OpenAI-compatible model endpoint, and returns structured JSON that an agent can act on.

## What This Server Offers

- Runs explicit validation commands, such as `npm test`, `npm run build`, `pytest`, `cargo test`, or any command supplied by the agent.
- Auto-detects common project validation commands for Node.js, Rust, Go, and Python projects.
- Stores full command logs under `.codex-local-test-runs/` in the target workspace.
- Trims long logs before sending them to the local model, preserving beginning and ending context.
- Uses command exit codes as the source of truth for pass/fail classification.
- Uses a local LLM to summarize failures, identify likely affected files, and suggest fixes.
- Reviews changed files under 500 KB before expensive validation runs.
- Can compare current auto-detected validation behavior with a saved baseline.

## Exposed MCP Tools

### `run_test_verdict`

Runs one explicit command or a set of auto-detected validation commands in a workspace.

Inputs:

- `workspacePath`: absolute path to the target workspace.
- `taskSummary`: short description of the change or validation goal.
- `changedFiles`: optional repo-relative changed files.
- `testCommand`: optional command override. When omitted, command detection is used.

Returns a JSON verdict with:

- `verdict`: `pass`, `fail`, or `uncertain`.
- `confidence`: local model confidence from `0.0` to `1.0`.
- `commandsRun`: commands executed by the server.
- `summary`: compact result explanation.
- `failures`: structured failure details and suggested fixes.
- `rawLogPath`: path to the full log, relative to `workspacePath`.
- `needsRawLogs`: whether the local model needs more log context.

### `run_failure_triage`

Reads an existing log file and asks the local model for compact root-cause analysis.

Use this after `run_test_verdict` returns `fail` or `uncertain` and the initial summary is not enough to fix the issue.

### `run_changed_files_review`

Reads changed files under 500 KB and asks the local model for an advisory code review.

This is useful before slow test suites. Treat findings as hints, not proof. The model sees file contents, not full project semantics.

### `run_regression_check`

Runs auto-detected commands, compares the current success state with `.codex-local-test-runs/baseline.json`, writes the current run as the new baseline, and reports whether a regression was detected.

Use this only when baseline mutation is acceptable.

## Requirements

- Node.js 20 or newer.
- npm.
- An MCP-compatible client that can launch stdio servers.
- A local OpenAI-compatible chat completions endpoint.
- Validation tools required by target workspaces, such as npm scripts, pytest, Cargo, or Go tooling.

The local model endpoint must accept requests like:

```text
POST /v1/chat/completions
```

The response should follow the OpenAI chat completions shape with `choices[0].message.content`.

## Install and Build

Install dependencies:

```sh
npm install
```

Build the TypeScript server:

```sh
npm run build
```

Start the server manually:

```sh
npm start
```

For development, run the TypeScript compiler in watch mode:

```sh
npm run dev
```

## Local LLM Configuration

The server reads these environment variables:

- `LOCAL_LLM_API_URL`: base URL for the local OpenAI-compatible endpoint. Defaults to `http://localhost:8080/v1`.
- `LOCAL_LLM_MODEL`: model name sent in chat completion requests. Defaults to `local-model`.

Example:

```sh
LOCAL_LLM_API_URL=http://localhost:8080/v1 \
LOCAL_LLM_MODEL=local-model \
npm start
```

If the local model is unavailable, returns invalid JSON, or cannot classify the result, the server reports an `uncertain` verdict or an advisory review issue instead of inventing confidence.

## MCP Client Setup

Build the server first, then configure your MCP client to launch `dist/index.js` with Node.

Example stdio configuration:

```json
{
  "mcpServers": {
    "local_tester": {
      "command": "node",
      "args": ["/absolute/path/to/local-tester-mcp/dist/index.js"],
      "env": {
        "LOCAL_LLM_API_URL": "http://localhost:8080/v1",
        "LOCAL_LLM_MODEL": "local-model"
      }
    }
  }
}
```

For Codex-style TOML configuration, the shape is typically:

```toml
[mcp_servers.local_tester]
command = "node"
args = ["/absolute/path/to/local-tester-mcp/dist/index.js"]

[mcp_servers.local_tester.env]
LOCAL_LLM_API_URL = "http://localhost:8080/v1"
LOCAL_LLM_MODEL = "local-model"
```

If your client supports tool allowlists, ensure these tools are enabled:

```text
run_test_verdict
run_failure_triage
run_changed_files_review
run_regression_check
```

Restart or reload the MCP client after changing the server path, environment variables, or enabled tool list.

## Typical Agent Workflow

1. Identify the target workspace as an absolute path.
2. Check the target workspace instructions, such as `AGENTS.md` or `agents.md`.
3. Review changed files with `run_changed_files_review` when the files are small enough and a lightweight review is useful.
4. Run `run_test_verdict` with an explicit `testCommand` when the correct validation command is known.
5. Omit `testCommand` only when auto-detection is appropriate.
6. Use the returned JSON as the primary signal.
7. If the verdict is `fail` or `uncertain`, call `run_failure_triage` on the returned log path before reading raw logs.
8. Report the command, verdict, summary, and residual risk without pasting raw logs unless necessary.

## Auto-Detected Commands

When `testCommand` is omitted, the server checks the target workspace:

- `package.json`: runs available `build`, `typecheck`, `lint`, and `test` scripts in that order. If no `test` script exists, it still attempts `npm test`.
- `Cargo.toml`: runs `cargo check` and `cargo test`.
- `go.mod`: runs `go build ./...` and `go test ./...`.
- Python test markers such as `pytest.ini`, `conftest.py`, `requirements.txt`, or `Pipfile`: runs `python manage.py test` for Django projects with `manage.py`, otherwise `pytest`.

If no known project type is detected, the server returns `uncertain` without running commands.

## Logs and Baselines

The server writes full command logs under:

```text
<workspacePath>/.codex-local-test-runs/
```

`run_test_verdict` returns `rawLogPath` relative to `workspacePath`.

`run_regression_check` also reads and writes:

```text
<workspacePath>/.codex-local-test-runs/baseline.json
```

Because `run_regression_check` overwrites the baseline with the current run, avoid it when you need a read-only check or stable historical baselines.

## Development Notes

- Source files live in `src/`; compiled files are emitted to `dist/`.
- The server communicates over stdio using `@modelcontextprotocol/sdk`.
- Keep MCP tool contracts stable and update user-facing docs when behavior changes.
- `skill/skill-example.md` documents how agents should use these tools. Keep it aligned with this README and the implementation.
- Run `npm run build` after TypeScript changes.

## Troubleshooting

- Tool is missing in the client: confirm the server was rebuilt, the MCP client points at `dist/index.js`, and the tool is enabled if the client uses allowlists.
- Verdict is always `uncertain`: confirm the local model endpoint is running and supports `/v1/chat/completions`.
- Command fails but summary says pass: the implementation should override that to `fail`; inspect exit code handling if this occurs.
- Raw log path cannot be found: resolve relative `rawLogPath` against the same `workspacePath` used in the tool call.
- Regression check changes unexpectedly: remember that `run_regression_check` writes the current run as the new baseline.
