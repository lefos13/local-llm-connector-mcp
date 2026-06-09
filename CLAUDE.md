# Claude Project Instructions

`AGENTS.md` is the source of truth for this project. This file adds Claude-specific operating notes only — read `AGENTS.md` first.

## Before Changing Files

- Check for nested `AGENTS.md` / `CLAUDE.md` files before editing subdirectories.
- Inspect `git status` and avoid overwriting changes you did not make.
- Treat `README.md` and `skill/skill-example.md` as part of the public contract.

## Tools

`check_local_llm_health`, `run_test_verdict`, `run_failure_triage`, `run_changed_files_review`, `run_regression_check`, `run_command_digest`, `query_log`, `grep_log`, `scout_codebase`

## Key Implementation Rules

- Keep tool names, input schemas, and output fields stable unless the user requests a contract migration.
- Command exit codes are authoritative. A non-zero exit must not become a passing verdict.
- Keep path handling rooted in `workspacePath`. No remote LLM calls by default.
- Analytics go to `<workspacePath>/.codex-local-test-runs/`, never the server's own directory.

## Documentation and Plugin Sync

When server behavior, tool contracts, or `skill/skill-example.md` change: update `README.md` and `skill/skill-example.md`, bump `VERSION` in all three generator scripts (`generate-plugin-antigravity.js`, `generate-plugin-claude.js`, `generate-plugin-codex.js`), then run `npm run build:plugin`. Never edit `plugin/` files manually.

## Validation

- Run `npm run build` after TypeScript changes.
- Request network privileges before `npm install`.
- For docs-only changes, run `npm run build:plugin` if skill docs changed; no server build needed.

## Comment Style

Use `/* ... */` at the top of large added/modified code blocks when the logic needs explanation. No stacks of `//` comments for multi-line explanations.

## Response Style

Include: what changed, why it was necessary, what verification was run, any remaining risk.
