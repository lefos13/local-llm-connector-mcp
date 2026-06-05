"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const detector_1 = require("./detector");
const runner_1 = require("./runner");
const llm_1 = require("./llm");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const server = new index_js_1.Server({
    name: 'local-tester-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'run_test_verdict',
                description: 'Runs build/lint/tests in the workspace and triages results using a local LLM to output a compact verdict.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        workspacePath: {
                            type: 'string',
                            description: 'Absolute path to the project workspace directory.'
                        },
                        taskSummary: {
                            type: 'string',
                            description: 'Summary of the task or code modifications Codex is performing.'
                        },
                        changedFiles: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Optional list of files changed during this session.'
                        },
                        testCommand: {
                            type: 'string',
                            description: 'Optional manual shell command override (e.g. "npm test" or "npm run lint && npm test").'
                        }
                    },
                    required: ['workspacePath', 'taskSummary']
                }
            },
            {
                name: 'run_failure_triage',
                description: 'Analyzes a log file to determine failure cause and suggest a fix.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        logPath: { type: 'string', description: 'Path to log file.' }
                    },
                    required: ['logPath']
                }
            },
            {
                name: 'run_changed_files_review',
                description: 'Reviews modified files for basic regressions or errors before running test suite.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        workspacePath: { type: 'string' },
                        changedFiles: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['workspacePath', 'changedFiles']
                }
            },
            {
                name: 'run_regression_check',
                description: 'Compares test behavior against a baseline output to find newly introduced failures.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        workspacePath: { type: 'string' }
                    },
                    required: ['workspacePath']
                }
            }
        ]
    };
});
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === 'run_test_verdict') {
        const { workspacePath, taskSummary, changedFiles = [], testCommand } = args;
        try {
            // 1. Determine commands to execute
            let commandsToRun = [];
            if (testCommand) {
                commandsToRun = [testCommand];
            }
            else {
                commandsToRun = await (0, detector_1.detectCommands)(workspacePath);
            }
            if (commandsToRun.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                verdict: 'uncertain',
                                confidence: 0.5,
                                commandsRun: [],
                                summary: 'No tests or build tools detected in workspace directory.',
                                failures: [],
                                rawLogPath: ''
                            }, null, 2)
                        }
                    ]
                };
            }
            // 2. Run commands
            const suiteResult = await (0, runner_1.runSuite)(commandsToRun, workspacePath);
            // Create a dictionary of command -> exitCode for easy triaging
            const exitCodes = {};
            let absoluteFail = false;
            for (const res of suiteResult.results) {
                exitCodes[res.command] = res.exitCode;
                if (res.exitCode !== 0) {
                    absoluteFail = true;
                }
            }
            // 3. Call local LLM
            const triage = await (0, llm_1.queryLocalLLM)(taskSummary, commandsToRun, exitCodes, changedFiles, suiteResult.trimmedLogContent);
            // Map local LLM verdict to overall result
            // Keep safety: if any command returned non-zero code, verdict must be 'fail' (or 'uncertain' if LLM failed)
            let finalVerdict = triage.verdict;
            if (absoluteFail && finalVerdict === 'pass') {
                finalVerdict = 'fail'; // Override faulty LLM intuition
            }
            else if (!absoluteFail && finalVerdict === 'fail') {
                finalVerdict = 'pass'; // Override if everything exited with 0
            }
            const output = {
                verdict: finalVerdict,
                confidence: triage.confidence,
                commandsRun: commandsToRun,
                summary: triage.summary,
                failures: triage.failures,
                rawLogPath: suiteResult.rawLogPath,
                needsRawLogs: triage.needsRawLogs
            };
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(output, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error executing run_test_verdict: ${err.message || err}`
                    }
                ],
                isError: true
            };
        }
    }
    // Implement actual tool handlers
    if (name === 'run_failure_triage') {
        const { logPath } = args;
        try {
            const resolvedPath = path.resolve(logPath);
            if (!fs.existsSync(resolvedPath)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: Log file not found at ${resolvedPath}`
                        }
                    ],
                    isError: true
                };
            }
            const logContent = fs.readFileSync(resolvedPath, 'utf8');
            const trimmed = (0, runner_1.trimLog)(logContent);
            const triage = await (0, llm_1.queryLocalLLM)("Triage request for log file", [], {}, [], trimmed);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            verdict: triage.verdict,
                            confidence: triage.confidence,
                            summary: triage.summary,
                            failures: triage.failures,
                            needsRawLogs: triage.needsRawLogs
                        }, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error executing run_failure_triage: ${err.message || err}`
                    }
                ],
                isError: true
            };
        }
    }
    if (name === 'run_changed_files_review') {
        const { workspacePath, changedFiles } = args;
        try {
            const filesToReview = [];
            for (const file of changedFiles) {
                const fullPath = path.resolve(workspacePath, file);
                if (fs.existsSync(fullPath)) {
                    const stat = fs.statSync(fullPath);
                    if (stat.isFile() && stat.size < 500 * 1024) { // Only read files under 500KB
                        const content = fs.readFileSync(fullPath, 'utf8');
                        filesToReview.push({ filename: file, content });
                    }
                }
            }
            if (filesToReview.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                hasIssues: false,
                                issues: [],
                                summary: 'No changed files could be read for review.'
                            }, null, 2)
                        }
                    ]
                };
            }
            const review = await (0, llm_1.queryCodeReview)(filesToReview);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(review, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error executing run_changed_files_review: ${err.message || err}`
                    }
                ],
                isError: true
            };
        }
    }
    if (name === 'run_regression_check') {
        const { workspacePath } = args;
        try {
            const commandsToRun = await (0, detector_1.detectCommands)(workspacePath);
            if (commandsToRun.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                status: 'uncertain',
                                message: 'No test commands detected.'
                            }, null, 2)
                        }
                    ]
                };
            }
            const suiteResult = await (0, runner_1.runSuite)(commandsToRun, workspacePath);
            const exitCodes = {};
            let hasFailures = false;
            for (const res of suiteResult.results) {
                exitCodes[res.command] = res.exitCode;
                if (res.exitCode !== 0) {
                    hasFailures = true;
                }
            }
            const baselinePath = path.join(workspacePath, '.codex-local-test-runs', 'baseline.json');
            let comparison = 'No baseline found. Saving current run as baseline.';
            let isRegression = false;
            const currentRunData = {
                exitCodes,
                timestamp: new Date().toISOString(),
                success: !hasFailures
            };
            if (fs.existsSync(baselinePath)) {
                try {
                    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
                    isRegression = hasFailures && baseline.success;
                    comparison = `Baseline success state: ${baseline.success}. Current success state: ${!hasFailures}. Regression detected: ${isRegression}`;
                }
                catch (e) {
                    comparison = `Error reading baseline: ${e.message || e}. Overwriting with current run.`;
                }
            }
            // Save current run as baseline for future checks
            fs.writeFileSync(baselinePath, JSON.stringify(currentRunData, null, 2), 'utf8');
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            isRegression,
                            comparison,
                            currentRun: currentRunData,
                            rawLogPath: suiteResult.rawLogPath
                        }, null, 2)
                    }
                ]
            };
        }
        catch (err) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error executing run_regression_check: ${err.message || err}`
                    }
                ],
                isError: true
            };
        }
    }
    throw new Error(`Unknown tool: ${name}`);
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error('Server execution error:', error);
    process.exit(1);
});
