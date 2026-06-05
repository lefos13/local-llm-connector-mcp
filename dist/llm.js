"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryLocalLLM = queryLocalLLM;
exports.queryCodeReview = queryCodeReview;
/**
 * Extracts a JSON substring from a potentially conversational or markdown-wrapped model output.
 */
function extractJSON(text) {
    // Try to find markdown block first
    const markdownRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = text.match(markdownRegex);
    if (match && match[1]) {
        return match[1].trim();
    }
    // Fallback: search for first '{' and last '}'
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        return text.substring(startIdx, endIdx + 1).trim();
    }
    return text;
}
async function queryLocalLLM(taskSummary, commandsRun, exitCodes, changedFiles, trimmedLogs) {
    const apiUrl = process.env.LOCAL_LLM_API_URL || 'http://localhost:8080/v1';
    const modelName = process.env.LOCAL_LLM_MODEL || 'local-model';
    const systemPrompt = `You are a diagnostic and test-log triage assistant.
You analyze build logs, linter outputs, typechecker warnings/errors, and test execution results.
You do not decide pass/fail from intuition.
Use command exit codes as truth.

Analyze the output log, exit codes, recent changes, and task summary.
Identify any failures (such as compilation errors, type mismatches, linter infractions, or failing tests), explain why they occurred, and suggest a specific fix.

Return JSON ONLY matching the following schema. Do not write any conversational text or explanation outside the JSON block.

Schema:
{
  "verdict": "pass" | "fail" | "uncertain",
  "confidence": number (between 0.0 and 1.0),
  "summary": "String explaining what passed or failed",
  "likelyRelevantToRecentChanges": boolean,
  "failures": [
    {
      "file": "path/to/failed_file.ts" or null,
      "reason": "Clear explanation of the error/failure",
      "suggestedFix": "Code adjustment recommendation or null"
    }
  ],
  "needsRawLogs": boolean (true if log is too trimmed to understand error details)
}`;
    const userPrompt = `Task Summary: ${taskSummary}
Changed Files: ${JSON.stringify(changedFiles)}
Commands Run with Exit Codes: ${JSON.stringify(exitCodes)}

Logs:
${trimmedLogs}`;
    try {
        const response = await fetch(`${apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            }),
        });
        if (!response.ok) {
            throw new Error(`Local LLM API error: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json());
        const rawContent = data.choices?.[0]?.message?.content || '';
        if (!rawContent) {
            throw new Error('Empty response from local LLM');
        }
        const jsonString = extractJSON(rawContent);
        const result = JSON.parse(jsonString);
        // Validate verdict values
        if (!['pass', 'fail', 'uncertain'].includes(result.verdict)) {
            result.verdict = 'uncertain';
        }
        return result;
    }
    catch (error) {
        // If the local model is offline, fails to respond, or output is unparseable
        return {
            verdict: 'uncertain',
            confidence: 0.0,
            summary: `Failed to triage using local LLM: ${error.message || error}`,
            likelyRelevantToRecentChanges: false,
            failures: [],
            needsRawLogs: true,
        };
    }
}
async function queryCodeReview(files) {
    const apiUrl = process.env.LOCAL_LLM_API_URL || 'http://localhost:8080/v1';
    const modelName = process.env.LOCAL_LLM_MODEL || 'local-model';
    const systemPrompt = `You are a code review assistant.
Analyze the provided code changes in the files.
Check for basic syntax errors, typical logical bugs, formatting issues, type errors, or potential regressions.

Return JSON ONLY matching the following schema. Do not write any conversational text or explanation outside the JSON block.

Schema:
{
  "hasIssues": boolean,
  "issues": [
    {
      "file": "relative/path/to/file.ts",
      "line": number (optional, line number of the issue),
      "severity": "error" | "warning",
      "description": "Clear explanation of the issue/concern",
      "suggestedFix": "Code adjustment recommendation or null"
    }
  ]
}`;
    let userPrompt = "Files to review:\n";
    for (const f of files) {
        userPrompt += `\n--- File: ${f.filename} ---\n${f.content}\n`;
    }
    try {
        const response = await fetch(`${apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            }),
        });
        if (!response.ok) {
            throw new Error(`Local LLM API error: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json());
        const rawContent = data.choices?.[0]?.message?.content || '';
        if (!rawContent) {
            throw new Error('Empty response from local LLM');
        }
        const jsonString = extractJSON(rawContent);
        return JSON.parse(jsonString);
    }
    catch (error) {
        return {
            hasIssues: true,
            issues: [
                {
                    file: files[0]?.filename || 'unknown',
                    severity: 'warning',
                    description: `Failed to review code using local LLM: ${error.message || error}`,
                    suggestedFix: null
                }
            ]
        };
    }
}
