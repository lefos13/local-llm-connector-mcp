# OpenRouter API Key Support — Design Spec

**Date:** 2026-06-09  
**Status:** Approved

---

## Overview

Add OpenRouter as the primary LLM provider for the `local-tester-mcp` plugin. When `OPENROUTER_API_KEY` is set, all LLM calls route through `https://openrouter.ai/api/v1`. If the OpenRouter call fails, the server automatically retries using the local LLM endpoint. When no API key is configured, the existing local LLM behavior is unchanged.

---

## Architecture

All changes are confined to `src/llm.ts`. No tool contracts, input schemas, or output fields change. The public functions (`queryLocalLLM`, `queryCodeReview`, `queryCommandDigest`, `queryScout`, `queryLogQuestion`) are unaffected except for swapping one internal call.

### Provider Resolution

The `LocalLLMProvider` interface is extended to `LLMProvider` with an `authHeaders` field:

```ts
interface LLMProvider {
  taskType: LLMTaskType;
  providerName: string;       // 'openrouter' | 'local-openai-compatible'
  apiUrl: string;
  model: string;
  authHeaders: Record<string, string>;
}
```

`resolveProvider(taskType)` checks `process.env.OPENROUTER_API_KEY` first:

- **OpenRouter path:** `apiUrl = 'https://openrouter.ai/api/v1'`, `providerName = 'openrouter'`, `authHeaders = { Authorization: 'Bearer <key>' }`. Model resolution order: `OPENROUTER_<TASK>_MODEL` → `OPENROUTER_MODEL` → `'openai/gpt-4o-mini'`.
- **Local path:** unchanged — `LOCAL_LLM_API_URL`, `LOCAL_LLM_MODEL`, per-task `LOCAL_LLM_*_MODEL`, `authHeaders = {}`.

### Transport

`callChatCompletion` spreads `provider.authHeaders` into the fetch headers — a one-line change. No other logic changes in this function.

### Fallback Wrapper

A new `callWithFallback(taskType, systemPrompt, userPrompt)` function:

1. Calls `callChatCompletion` with the resolved provider.
2. If it throws **and** the provider is OpenRouter, resolves the local provider explicitly and retries once.
3. Attaches `fallbackReason` to the metadata so callers can see that a fallback occurred.
4. If the local retry also fails, throws so the caller's existing error handler fires.

All existing public LLM functions replace their `callChatCompletion` call with `callWithFallback`.

### Health Check

`checkLocalLLMHealth` checks for `OPENROUTER_API_KEY` at entry. If set, returns immediately:

```ts
{
  available: true,
  apiBase: 'https://openrouter.ai/api/v1',
  llmProvider: 'openrouter',
  skipped: true
}
```

No network call is made. The assumption is that if the key is set it is valid; a failed live call will surface the error naturally via `fallbackReason`.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes (to enable OpenRouter) | Enables OpenRouter mode. Absence triggers local LLM path. |
| `OPENROUTER_MODEL` | No | Default model for all tasks. Falls back to `openai/gpt-4o-mini`. |
| `OPENROUTER_VERDICT_MODEL` | No | Per-task override for `verdict` |
| `OPENROUTER_TRIAGE_MODEL` | No | Per-task override for `triage` |
| `OPENROUTER_REVIEW_MODEL` | No | Per-task override for `review` |
| `OPENROUTER_DIGEST_MODEL` | No | Per-task override for `digest` |
| `OPENROUTER_SCOUT_MODEL` | No | Per-task override for `scout` |
| `OPENROUTER_QUERY_MODEL` | No | Per-task override for `query` |

### JSON Mode Requirement

**All OpenRouter calls send `response_format: { type: "json_object" }`.** The selected model must support JSON mode. Models that do not support it will return an API error, which will trigger a fallback to the local LLM (if configured) or surface as an error.

Known-compatible models (non-exhaustive):
- `openai/gpt-4o`
- `openai/gpt-4o-mini`
- `anthropic/claude-3-5-sonnet`
- `anthropic/claude-3-haiku`
- `google/gemini-flash-1.5`

Check the [OpenRouter models page](https://openrouter.ai/models) and filter by "JSON mode" support before choosing a model.

---

## Data Flow

```
callWithFallback(taskType, system, user)
  │
  ├── resolveProvider(taskType)
  │     ├── OPENROUTER_API_KEY set?  → OpenRouter provider (URL + auth headers + model)
  │     └── not set?                → Local provider (existing logic)
  │
  ├── callChatCompletion(provider, system, user)
  │     └── fetch(apiUrl/chat/completions, { headers: { ...authHeaders } })
  │
  └── on throw + provider is OpenRouter
        ├── resolveLocalProvider(taskType)
        └── callChatCompletion(localProvider, system, user)  [one retry]
```

---

## Plugin Config Placeholders

Each generated plugin config ships with all OpenRouter env vars pre-populated as empty-string placeholders so users know exactly which keys to fill in after installing. The generator scripts (`scripts/generate-plugin-antigravity.js`, `scripts/generate-plugin-claude.js`, `scripts/generate-plugin-codex.js`) must emit the following `env` block shape in their respective `.mcp.json` / `mcp_config.json` outputs:

```json
"env": {
  "OPENROUTER_API_KEY": "",
  "OPENROUTER_MODEL": "",
  "OPENROUTER_VERDICT_MODEL": "",
  "OPENROUTER_TRIAGE_MODEL": "",
  "OPENROUTER_REVIEW_MODEL": "",
  "OPENROUTER_DIGEST_MODEL": "",
  "OPENROUTER_SCOUT_MODEL": "",
  "OPENROUTER_QUERY_MODEL": "",
  "LOCAL_LLM_API_URL": "http://localhost:8080/v1",
  "LOCAL_LLM_MODEL": "local-model"
}
```

An empty string is treated as absent by the server (same as unset). Users fill in `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` at minimum; all other vars are optional overrides. The `LOCAL_LLM_API_URL` and `LOCAL_LLM_MODEL` entries remain populated as they are the fallback path.

The install location of the config file varies per client:

| Client | Config file in plugin output | Typical install location |
|---|---|---|
| Claude Code | `plugin/claude/.mcp.json` | `~/.claude/plugins/cache/<plugin-name>/` |
| Codex | `plugin/codex/.mcp.json` | Codex plugin directory |
| Antigravity | `plugin/antigravity/mcp_config.json` | `~/.gemini/config/plugins/<plugin-name>/` |

---

## Documentation Changes

- `README.md`: New **OpenRouter Configuration** section with:
  - The full env var table and purpose of each variable.
  - Provider priority explanation (OpenRouter → local LLM fallback).
  - The JSON-mode model requirement note with the known-compatible model list.
  - Instructions for where to edit the config file after install, per client.
- `skill/skill-example.md`: Same env var table, JSON-mode warning, and per-client config location added to the configuration section.
- Plugin version bumped in `scripts/generate-plugin-antigravity.js`, `scripts/generate-plugin-claude.js`, `scripts/generate-plugin-codex.js`.
- `npm run build:plugin` regenerates `plugin/` after TypeScript build.

---

## Out of Scope

- No UI for selecting models at runtime.
- No per-call model override via tool input parameters.
- No streaming support.
- No OAuth flow — API key only.
