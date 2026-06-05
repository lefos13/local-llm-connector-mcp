import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface RunCommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

export interface ExecutedSuiteResult {
  results: RunCommandResult[];
  rawLogPath: string;
  rawLogContent: string;
  trimmedLogContent: string;
}

/**
 * Runs a single shell command inside the workspacePath, capturing all stdout and stderr.
 */
export function runCommand(command: string, workspacePath: string, timeoutMs: number = 300000): Promise<RunCommandResult> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: workspacePath,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer to prevent overflow
    }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const exitCode = error ? (error.code ?? 1) : 0;
      
      resolve({
        command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        error: error ? error.message : undefined
      });
    });

    // Handle timeout
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      const durationMs = Date.now() - startTime;
      resolve({
        command,
        exitCode: -1,
        stdout: '',
        stderr: `Command timed out after ${timeoutMs / 1000}s.`,
        durationMs,
        error: 'Timeout'
      });
    }, timeoutMs);

    child.on('exit', () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Truncates logs intelligently to avoid overloading LLM contexts while preserving failure trace context.
 */
export function trimLog(fullLog: string, maxStartLines = 100, maxEndLines = 200): string {
  const lines = fullLog.split('\n');
  if (lines.length <= maxStartLines + maxEndLines) {
    return fullLog;
  }

  const startPart = lines.slice(0, maxStartLines).join('\n');
  const endPart = lines.slice(lines.length - maxEndLines).join('\n');
  const omittedCount = lines.length - (maxStartLines + maxEndLines);

  return `${startPart}\n\n... [TRUNCATED - ${omittedCount} LINES OMITTED] ...\n\n${endPart}`;
}

/**
 * Runs multiple commands in sequence. Creates a log directory and saves the full logs, returning both full and trimmed representations.
 */
export async function runSuite(commands: string[], workspacePath: string): Promise<ExecutedSuiteResult> {
  const results: RunCommandResult[] = [];
  const logDir = path.join(workspacePath, '.codex-local-test-runs');

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFileName = `${timestamp}.log`;
  const rawLogPath = path.join(logDir, logFileName);

  let fullLogAccumulator = '';

  for (const cmd of commands) {
    fullLogAccumulator += `========================================================\n`;
    fullLogAccumulator += `COMMAND: ${cmd}\n`;
    fullLogAccumulator += `START TIME: ${new Date().toISOString()}\n`;
    fullLogAccumulator += `========================================================\n\n`;

    const res = await runCommand(cmd, workspacePath);
    results.push(res);

    fullLogAccumulator += `--- STDOUT ---\n${res.stdout}\n`;
    if (res.stderr) {
      fullLogAccumulator += `--- STDERR ---\n${res.stderr}\n`;
    }
    
    fullLogAccumulator += `\n--- EXIT CODE: ${res.exitCode} (Duration: ${res.durationMs}ms) ---\n\n`;
  }

  // Write log to workspace file
  fs.writeFileSync(rawLogPath, fullLogAccumulator, 'utf8');

  // Get trimmed representation of the final logs
  const trimmedLogContent = trimLog(fullLogAccumulator);

  // Return path relative to the workspace path for the client
  const relativeLogPath = path.relative(workspacePath, rawLogPath);

  return {
    results,
    rawLogPath: relativeLogPath,
    rawLogContent: fullLogAccumulator,
    trimmedLogContent
  };
}
