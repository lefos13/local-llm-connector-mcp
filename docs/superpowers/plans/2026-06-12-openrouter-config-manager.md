# OpenRouter Config Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-shipped interactive script that sets up, updates, deletes, and reports OpenRouter configuration for Codex, Claude, and Gemini/Antigravity without requiring users to edit cached plugin files.

**Architecture:** Implement a single Node.js CLI under `scripts/` that writes client-owned stable config files where available and also manages macOS GUI-session environment variables through `launchctl` so apps launched normally can inherit the same `OPENROUTER_*` values. Keep the plugin runtime behavior unchanged except for documentation that now points users to the config manager.

**Tech Stack:** Node.js, built-in `fs`/`path`/`os`/`readline`, JSON file updates, shell execution via `child_process`, Markdown docs

---

### Task 1: Add the config manager script

**Files:**
- Create: `scripts/manage-openrouter-config.js`
- Modify: `package.json`

- [ ] **Step 1: Define the command surface**

  Implement `setup`, `update`, `delete`, and `status` subcommands with an interactive default when no subcommand is provided.

- [ ] **Step 2: Implement safe config file handling**

  Read and write:
  - `~/.claude/settings.json`
  - `~/.gemini/config/mcp_config.json`
  Create timestamped backups before mutation and preserve unrelated settings.

- [ ] **Step 3: Implement macOS GUI-session environment support**

  Use `launchctl setenv` and `launchctl unsetenv` for `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and optional per-task overrides so GUI-launched apps can inherit the variables.

- [ ] **Step 4: Implement status reporting**

  Show the detected values per managed surface, with secrets redacted and clear notes when a client is unconfigured.

### Task 2: Define the persisted configuration behavior per client

**Files:**
- Modify: `scripts/manage-openrouter-config.js`

- [ ] **Step 1: Claude behavior**

  Store `OPENROUTER_*` under the top-level `env` object in `~/.claude/settings.json`.

- [ ] **Step 2: Gemini / Antigravity behavior**

  Ensure `~/.gemini/config/mcp_config.json` has a `local_tester` server entry with `OPENROUTER_*` inside `mcpServers.local_tester.env`, while preserving existing entries like `notebooks` and `visualization`.

- [ ] **Step 3: Codex behavior**

  Do not write secrets into plugin cache or `~/.codex/config.toml`; rely on `launchctl`-managed GUI environment plus the plugin's `env_vars` pass-through.

### Task 3: Update docs and generated plugin guidance

**Files:**
- Modify: `README.md`
- Modify: `skill/skill-example.md`
- Modify: `scripts/generate-plugin-antigravity.js`
- Modify: `scripts/generate-plugin-claude.js`
- Modify: `scripts/generate-plugin-codex.js`

- [ ] **Step 1: Document the new workflow**

  Add usage examples for the config manager script and position it as the recommended way to configure OpenRouter.

- [ ] **Step 2: Clarify platform-specific persistence**

  Explain that Claude and Gemini configs are updated directly, while Codex relies on `launchctl`-persisted environment plus plugin `env_vars`.

- [ ] **Step 3: Keep generated READMEs aligned**

  Update generator-owned README strings so regenerated plugin docs match the repo-level instructions.

### Task 4: Verify behavior safely

**Files:**
- Modify: none required beyond test artifacts in temp directories

- [ ] **Step 1: Run the project build**

  Run `npm run build`.

- [ ] **Step 2: Run plugin regeneration**

  Run `npm run build:plugin`.

- [ ] **Step 3: Exercise the config manager in a temp HOME**

  Run the script against a temporary home directory fixture so JSON mutations and backup behavior can be validated without changing the real user config during automated verification.

- [ ] **Step 4: Verify generated docs and configs**

  Inspect the regenerated plugin configs and README files to ensure the documented setup flow now points to the config manager.
