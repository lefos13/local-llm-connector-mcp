import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { detectCommands } from './detector';
import { runSuite, trimLog } from './runner';
import { queryLocalLLM, queryCodeReview } from './llm';
import { RunTestVerdictArgs } from './types';
import * as fs from 'fs';
import * as path from 'path';

const server = new Server(
  {
    name: 'local-tester-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'run_test_verdict') {
    const {
      workspacePath,
      taskSummary,
      changedFiles = [],
      testCommand
    } = args as unknown as RunTestVerdictArgs;

    try {
      // 1. Determine commands to execute
      let commandsToRun: string[] = [];
      if (testCommand) {
        commandsToRun = [testCommand];
      } else {
        commandsToRun = await detectCommands(workspacePath);
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
      const suiteResult = await runSuite(commandsToRun, workspacePath);

      // Create a dictionary of command -> exitCode for easy triaging
      const exitCodes: Record<string, number> = {};
      let absoluteFail = false;
      for (const res of suiteResult.results) {
        exitCodes[res.command] = res.exitCode;
        if (res.exitCode !== 0) {
          absoluteFail = true;
        }
      }

      // 3. Call local LLM
      const triage = await queryLocalLLM(
        taskSummary,
        commandsToRun,
        exitCodes,
        changedFiles,
        suiteResult.trimmedLogContent
      );

      // Map local LLM verdict to overall result
      // Keep safety: if any command returned non-zero code, verdict must be 'fail' (or 'uncertain' if LLM failed)
      let finalVerdict: 'pass' | 'fail' | 'uncertain' = triage.verdict;
      if (absoluteFail && finalVerdict === 'pass') {
        finalVerdict = 'fail'; // Override faulty LLM intuition
      } else if (!absoluteFail && finalVerdict === 'fail') {
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

    } catch (err: any) {
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
    const { logPath } = args as { logPath: string };
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
      const trimmed = trimLog(logContent);

      const triage = await queryLocalLLM(
        "Triage request for log file",
        [],
        {},
        [],
        trimmed
      );

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
    } catch (err: any) {
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
    const { workspacePath, changedFiles } = args as { workspacePath: string; changedFiles: string[] };
    try {
      const filesToReview: { filename: string; content: string }[] = [];
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

      const review = await queryCodeReview(filesToReview);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(review, null, 2)
          }
        ]
      };
    } catch (err: any) {
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
    const { workspacePath } = args as { workspacePath: string };
    try {
      const commandsToRun = await detectCommands(workspacePath);
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

      const suiteResult = await runSuite(commandsToRun, workspacePath);
      const exitCodes: Record<string, number> = {};
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
        } catch (e: any) {
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
    } catch (err: any) {
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server execution error:', error);
  process.exit(1);
});
