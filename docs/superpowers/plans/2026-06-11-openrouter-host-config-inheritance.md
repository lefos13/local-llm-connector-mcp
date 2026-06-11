# OpenRouter Host Config Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated local-tester plugins inherit OpenRouter credentials from stable host-owned MCP config or launch environment instead of blank plugin-scoped placeholders.

**Architecture:** Update the plugin generators so Claude and Antigravity match the existing Codex inheritance pattern, then align all generated README guidance and skill documentation around host-config inheritance. Rebuild plugin artifacts and validate fresh installs by removing the current plugin copies and reinstalling them into each client surface.

**Tech Stack:** Node.js, generator scripts, TypeScript build output, generated plugin assets, Markdown docs

---

### Task 1: Update generator behavior and versioning

**Files:**
- Modify: `scripts/generate-plugin-claude.js`
- Modify: `scripts/generate-plugin-antigravity.js`
- Modify: `scripts/generate-plugin-codex.js`

- [ ] **Step 1: Remove blank OpenRouter placeholders from generated plugin env blocks**

  Keep only local fallback defaults in generated plugin config so host-owned OpenRouter env can flow through unchanged.

- [ ] **Step 2: Bump plugin versions**

  Set all generator `VERSION` constants to the next patch release so regenerated plugin installs are distinguishable from stale caches.

- [ ] **Step 3: Update generator-owned README text**

  Change generated README strings so they recommend stable host config or launch environment first, with plugin-scoped config only as an explicit override path.

### Task 2: Update repository docs and skill guidance

**Files:**
- Modify: `README.md`
- Modify: `skill/skill-example.md`

- [ ] **Step 1: Rewrite OpenRouter setup guidance**

  Explain why generated plugins omit `OPENROUTER_*` placeholders and document the preferred configuration order: stable host config, launch environment, then plugin override only when desired.

- [ ] **Step 2: Keep examples aligned with new behavior**

  Remove examples that imply generated configs ship blank OpenRouter keys and keep examples limited to explicit override cases.

### Task 3: Rebuild and verify generated assets

**Files:**
- Modify: `plugin/claude/**`
- Modify: `plugin/codex/**`
- Regenerate: `plugin/antigravity/**`

- [ ] **Step 1: Run build commands**

  Run `npm run build` and `npm run build:plugin`.

- [ ] **Step 2: Inspect generated plugin configs**

  Confirm generated Claude, Codex, and Antigravity plugin configs omit `OPENROUTER_*` keys while still carrying local fallback keys.

- [ ] **Step 3: Inspect generated docs**

  Confirm generated plugin README files recommend stable host config inheritance.

### Task 4: Clean reinstall and end-to-end inheritance test

**Files:**
- Remove/reinstall: user-local plugin cache and marketplace copies for Codex, Claude, and Antigravity

- [ ] **Step 1: Snapshot active local config**

  Record current user-owned global or plugin config paths before cleanup so the test can restore only the intended stable settings.

- [ ] **Step 2: Remove installed plugin and marketplace copies**

  Delete current `local-tester` marketplace/cache installs for Codex, Claude, and Antigravity at the user’s request.

- [ ] **Step 3: Reinstall fresh plugin artifacts**

  Re-add the local marketplace where needed and copy or sync the Antigravity plugin folder back into `~/.gemini/config/plugins/local-tester`.

- [ ] **Step 4: Validate inherited OpenRouter behavior**

  Put `OPENROUTER_*` only in the stable host-owned config surface, inspect the freshly installed plugin configs to confirm the keys are absent there, then run the narrowest practical health or startup check to verify the server sees the inherited OpenRouter settings.
