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
exports.runCommand = runCommand;
exports.trimLog = trimLog;
exports.runSuite = runSuite;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Runs a single shell command inside the workspacePath, capturing all stdout and stderr.
 */
function runCommand(command, workspacePath, timeoutMs = 300000) {
    const startTime = Date.now();
    return new Promise((resolve) => {
        const child = (0, child_process_1.exec)(command, {
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
function trimLog(fullLog, maxStartLines = 100, maxEndLines = 200) {
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
async function runSuite(commands, workspacePath) {
    const results = [];
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
