import * as fs from 'fs';
import * as path from 'path';
import { estimateTokens } from './runner';
import { LLMUsage } from './llm';

/* Records compact per-tool context accounting without storing prompts, raw logs, file contents, or full model responses. */
export type MeasurementSource = 'api_usage' | 'estimated' | 'mixed';

export interface AnalyticsRecord {
  toolName: string;
  timestamp: string;
  targetWorkspacePath?: string;
  runId?: string;
  rawLogPath?: string;
  logPath?: string;
  commands?: string[];
  exitCodes?: Record<string, number>;
  rawSourceTokens: number;
  localLlmInputTokens: number;
  localLlmOutputTokens: number;
  localLlmTotalTokens: number;
  returnedToMainTokens: number;
  estimatedTokensSaved: number;
  savingsPercentage: number;
  measurementSource: MeasurementSource;
}

interface AnalyticsSummary {
  updatedAt: string;
  totalCalls: number;
  callsByTool: Record<string, number>;
  totalRawSourceTokens: number;
  totalLocalLlmTokens: number;
  totalReturnedToMainTokens: number;
  totalEstimatedMainContextTokensSaved: number;
  averageSavingsPercentage: number;
}

const LOG_DIR = '.codex-local-test-runs';
const ANALYTICS_FILE = 'analytics.json';
const SUMMARY_FILE = 'analytics-summary.json';
const MAX_RECORDS = 200;
const SERVER_PROJECT_ROOT = path.resolve(__dirname, '..');

export function analyticsStoreRoot(): string {
  return SERVER_PROJECT_ROOT;
}

function analyticsDir(): string {
  return path.join(analyticsStoreRoot(), LOG_DIR);
}

function readRecords(filePath: string): AnalyticsRecord[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? (parsed as AnalyticsRecord[]) : [];
  } catch {
    return [];
  }
}

function summarize(records: AnalyticsRecord[]): AnalyticsSummary {
  const summary: AnalyticsSummary = {
    updatedAt: new Date().toISOString(),
    totalCalls: records.length,
    callsByTool: {},
    totalRawSourceTokens: 0,
    totalLocalLlmTokens: 0,
    totalReturnedToMainTokens: 0,
    totalEstimatedMainContextTokensSaved: 0,
    averageSavingsPercentage: 0
  };

  let savingsTotal = 0;
  for (const record of records) {
    summary.callsByTool[record.toolName] = (summary.callsByTool[record.toolName] || 0) + 1;
    summary.totalRawSourceTokens += record.rawSourceTokens;
    summary.totalLocalLlmTokens += record.localLlmTotalTokens;
    summary.totalReturnedToMainTokens += record.returnedToMainTokens;
    summary.totalEstimatedMainContextTokensSaved += record.estimatedTokensSaved;
    savingsTotal += record.savingsPercentage;
  }

  summary.averageSavingsPercentage = records.length > 0 ? Number((savingsTotal / records.length).toFixed(4)) : 0;
  return summary;
}

export function inferWorkspaceFromLogPath(absLogPath: string): string {
  const marker = `${path.sep}${LOG_DIR}${path.sep}`;
  const idx = absLogPath.indexOf(marker);
  if (idx >= 0) {
    return absLogPath.slice(0, idx);
  }
  return path.dirname(absLogPath);
}

export function buildAnalyticsRecord(input: {
  toolName: string;
  rawSourceText: string;
  llmInputText?: string;
  responseText: string;
  llmUsage?: LLMUsage;
  targetWorkspacePath?: string;
  runId?: string;
  rawLogPath?: string;
  logPath?: string;
  commands?: string[];
  exitCodes?: Record<string, number>;
}): AnalyticsRecord {
  const rawSourceTokens = estimateTokens(input.rawSourceText);
  const returnedToMainTokens = estimateTokens(input.responseText);
  const estimatedInputTokens = estimateTokens(input.llmInputText || '');
  const usage = input.llmUsage;
  const localLlmInputTokens = usage?.promptTokens ?? estimatedInputTokens;
  const localLlmOutputTokens = usage?.completionTokens ?? 0;
  const localLlmTotalTokens = usage?.totalTokens ?? (localLlmInputTokens + localLlmOutputTokens);
  const estimatedTokensSaved = Math.max(0, rawSourceTokens - returnedToMainTokens);
  const savingsPercentage = rawSourceTokens > 0
    ? Number((estimatedTokensSaved / rawSourceTokens).toFixed(4))
    : 0;

  let measurementSource: MeasurementSource = 'estimated';
  if (usage?.source === 'api') {
    measurementSource = input.llmInputText ? 'mixed' : 'api_usage';
  } else if (usage?.source === 'estimated') {
    measurementSource = 'estimated';
  }

  return {
    toolName: input.toolName,
    timestamp: new Date().toISOString(),
    targetWorkspacePath: input.targetWorkspacePath,
    runId: input.runId,
    rawLogPath: input.rawLogPath,
    logPath: input.logPath,
    commands: input.commands,
    exitCodes: input.exitCodes,
    rawSourceTokens,
    localLlmInputTokens,
    localLlmOutputTokens,
    localLlmTotalTokens,
    returnedToMainTokens,
    estimatedTokensSaved,
    savingsPercentage,
    measurementSource
  };
}

/* Analytics are operational evidence, not part of the MCP contract. Writes are centralized in the MCP project so one UI can report every target workspace without touching those workspaces. */
export function recordAnalytics(_targetWorkspacePath: string, record: AnalyticsRecord): void {
  try {
    const dir = analyticsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const analyticsPath = path.join(dir, ANALYTICS_FILE);
    const records = readRecords(analyticsPath);
    records.push(record);
    const trimmed = records.length > MAX_RECORDS ? records.slice(records.length - MAX_RECORDS) : records;

    fs.writeFileSync(analyticsPath, JSON.stringify(trimmed, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, SUMMARY_FILE), JSON.stringify(summarize(trimmed), null, 2), 'utf8');
  } catch {
    /* ignore analytics write failures */
  }
}
