import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';

interface AnalyticsRecord {
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
  measurementSource: string;
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

interface AnalyticsPayload {
  storePath: string;
  analyticsPath: string;
  summaryPath: string;
  available: boolean;
  error?: string;
  summary: AnalyticsSummary;
  records: AnalyticsRecord[];
}

const LOG_DIR = '.codex-local-test-runs';
const DEFAULT_PORT = 8787;
const SERVER_PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv: string[]): { storePath: string; port: number } {
  let storePath = SERVER_PROJECT_ROOT;
  let port = Number(process.env.PORT || DEFAULT_PORT);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--store' || arg === '--workspace' || arg === '-w') && argv[i + 1]) {
      storePath = path.resolve(argv[++i]);
    } else if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      port = Number(argv[++i]);
    }
  }

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return { storePath, port };
}

function emptySummary(): AnalyticsSummary {
  return {
    updatedAt: '',
    totalCalls: 0,
    callsByTool: {},
    totalRawSourceTokens: 0,
    totalLocalLlmTokens: 0,
    totalReturnedToMainTokens: 0,
    totalEstimatedMainContextTokensSaved: 0,
    averageSavingsPercentage: 0
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function loadAnalytics(storePath: string): AnalyticsPayload {
  const analyticsPath = path.join(storePath, LOG_DIR, 'analytics.json');
  const summaryPath = path.join(storePath, LOG_DIR, 'analytics-summary.json');

  if (!fs.existsSync(analyticsPath) || !fs.existsSync(summaryPath)) {
    return {
      storePath,
      analyticsPath,
      summaryPath,
      available: false,
      error: `Analytics files were not found under ${path.join(storePath, LOG_DIR)}.`,
      summary: emptySummary(),
      records: []
    };
  }

  try {
    const records = readJson<AnalyticsRecord[]>(analyticsPath);
    const summary = readJson<AnalyticsSummary>(summaryPath);
    return {
      storePath,
      analyticsPath,
      summaryPath,
      available: true,
      summary,
      records: Array.isArray(records) ? records.slice().reverse() : []
    };
  } catch (error: any) {
    return {
      storePath,
      analyticsPath,
      summaryPath,
      available: false,
      error: `Failed to read analytics: ${error.message || error}`,
      summary: emptySummary(),
      records: []
    };
  }
}

function send(res: http.ServerResponse, statusCode: number, contentType: string, body: string): void {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/* The dashboard is intentionally shipped as one self-contained HTML document so the compiled dist command can run without bundlers, static asset copying, or extra dependencies. */
function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Tester Analytics</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --surface-2: #eef2f6;
      --text: #17202a;
      --muted: #627181;
      --border: #d8dee6;
      --accent: #0f766e;
      --accent-2: #1d4ed8;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .wrap {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 0;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
    }
    h2 {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    button {
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      font: inherit;
      padding: 8px 12px;
    }
    button:hover { border-color: var(--accent); }
    main {
      padding: 20px 0 32px;
    }
    .notice {
      display: none;
      border: 1px solid var(--border);
      border-left: 4px solid var(--danger);
      background: var(--surface);
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 16px;
      color: var(--text);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      min-height: 86px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 8px;
    }
    .value {
      color: var(--text);
      font-size: 24px;
      font-weight: 750;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }
    .section {
      margin-top: 18px;
    }
    .tool-list {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .tool-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .tool-row span:first-child {
      overflow-wrap: anywhere;
    }
    .table-wrap {
      overflow-x: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 920px;
    }
    th, td {
      border-bottom: 1px solid var(--border);
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--surface-2);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    tr:last-child td { border-bottom: 0; }
    code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .source {
      display: inline-block;
      border-radius: 999px;
      background: var(--surface-2);
      padding: 2px 8px;
      white-space: nowrap;
    }
    .pct {
      color: var(--accent);
      font-weight: 700;
    }
    .empty {
      padding: 26px;
      color: var(--muted);
      text-align: center;
    }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .tool-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .topbar { align-items: flex-start; flex-direction: column; }
      .grid, .tool-list { grid-template-columns: 1fr; }
      .wrap { width: min(100% - 20px, 1180px); }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div>
        <h1>Local Tester Analytics</h1>
        <div class="meta" id="store">Loading analytics store...</div>
      </div>
      <button type="button" id="refresh">Refresh</button>
    </div>
  </header>
  <main class="wrap">
    <div class="notice" id="notice"></div>
    <section class="grid" aria-label="Analytics summary">
      <div class="card"><div class="label">Total calls</div><div class="value" id="totalCalls">0</div></div>
      <div class="card"><div class="label">Raw source tokens</div><div class="value" id="rawTokens">0</div></div>
      <div class="card"><div class="label">Local LLM tokens</div><div class="value" id="llmTokens">0</div></div>
      <div class="card"><div class="label">Returned main-model tokens</div><div class="value" id="returnedTokens">0</div></div>
      <div class="card"><div class="label">Estimated tokens saved</div><div class="value" id="savedTokens">0</div></div>
      <div class="card"><div class="label">Average savings</div><div class="value" id="avgSavings">0%</div></div>
      <div class="card"><div class="label">Records loaded</div><div class="value" id="recordCount">0</div></div>
      <div class="card"><div class="label">Updated</div><div class="value" id="updatedAt">-</div></div>
    </section>
    <section class="section">
      <h2>Calls by Tool</h2>
      <div class="tool-list" id="toolList"></div>
    </section>
    <section class="section">
      <h2>Recent Events</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Tool</th>
              <th>Target Workspace</th>
              <th>Run / Log</th>
              <th>Source</th>
              <th>Raw</th>
              <th>LLM</th>
              <th>Returned</th>
              <th>Saved</th>
              <th>Savings</th>
            </tr>
          </thead>
          <tbody id="events"></tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    const ids = {
      store: document.getElementById('store'),
      notice: document.getElementById('notice'),
      totalCalls: document.getElementById('totalCalls'),
      rawTokens: document.getElementById('rawTokens'),
      llmTokens: document.getElementById('llmTokens'),
      returnedTokens: document.getElementById('returnedTokens'),
      savedTokens: document.getElementById('savedTokens'),
      avgSavings: document.getElementById('avgSavings'),
      recordCount: document.getElementById('recordCount'),
      updatedAt: document.getElementById('updatedAt'),
      toolList: document.getElementById('toolList'),
      events: document.getElementById('events')
    };

    const fmt = new Intl.NumberFormat();
    const percent = (n) => ((Number(n || 0) * 100).toFixed(1) + '%');
    const num = (n) => fmt.format(Number(n || 0));

    function setText(el, text) {
      el.textContent = text;
    }

    function renderTools(callsByTool) {
      ids.toolList.textContent = '';
      const entries = Object.entries(callsByTool || {}).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No tool calls recorded yet.';
        ids.toolList.appendChild(empty);
        return;
      }
      for (const [tool, count] of entries) {
        const row = document.createElement('div');
        row.className = 'tool-row';
        const name = document.createElement('span');
        name.textContent = tool;
        const value = document.createElement('strong');
        value.textContent = num(count);
        row.append(name, value);
        ids.toolList.appendChild(row);
      }
    }

    function renderEvents(records) {
      ids.events.textContent = '';
      if (!records || records.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 10;
        td.className = 'empty';
        td.textContent = 'No analytics records found.';
        tr.appendChild(td);
        ids.events.appendChild(tr);
        return;
      }
      for (const record of records) {
        const tr = document.createElement('tr');
        const cells = [
          new Date(record.timestamp).toLocaleString(),
          record.toolName,
          record.targetWorkspacePath || '-',
          record.runId || record.rawLogPath || record.logPath || '-',
          record.measurementSource,
          num(record.rawSourceTokens),
          num(record.localLlmTotalTokens),
          num(record.returnedToMainTokens),
          num(record.estimatedTokensSaved),
          percent(record.savingsPercentage)
        ];
        cells.forEach((value, index) => {
          const td = document.createElement('td');
          if (index === 2 || index === 3) {
            const code = document.createElement('code');
            code.textContent = value;
            td.appendChild(code);
          } else if (index === 4) {
            const span = document.createElement('span');
            span.className = 'source';
            span.textContent = value;
            td.appendChild(span);
          } else if (index === 9) {
            td.className = 'pct';
            td.textContent = value;
          } else {
            td.textContent = value;
          }
          tr.appendChild(td);
        });
        ids.events.appendChild(tr);
      }
    }

    async function load() {
      const res = await fetch('/api/analytics', { cache: 'no-store' });
      const payload = await res.json();
      const summary = payload.summary || {};
      setText(ids.store, payload.storePath || '-');
      setText(ids.totalCalls, num(summary.totalCalls));
      setText(ids.rawTokens, num(summary.totalRawSourceTokens));
      setText(ids.llmTokens, num(summary.totalLocalLlmTokens));
      setText(ids.returnedTokens, num(summary.totalReturnedToMainTokens));
      setText(ids.savedTokens, num(summary.totalEstimatedMainContextTokensSaved));
      setText(ids.avgSavings, percent(summary.averageSavingsPercentage));
      setText(ids.recordCount, num((payload.records || []).length));
      setText(ids.updatedAt, summary.updatedAt ? new Date(summary.updatedAt).toLocaleString() : '-');
      ids.notice.style.display = payload.available ? 'none' : 'block';
      ids.notice.textContent = payload.error || '';
      renderTools(summary.callsByTool);
      renderEvents(payload.records);
    }

    document.getElementById('refresh').addEventListener('click', load);
    load().catch((error) => {
      ids.notice.style.display = 'block';
      ids.notice.textContent = 'Failed to load analytics: ' + error.message;
    });
  </script>
</body>
</html>`;
}

function start(): void {
  const { storePath, port } = parseArgs(process.argv.slice(2));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/') {
      send(res, 200, 'text/html; charset=utf-8', renderHtml());
      return;
    }
    if (url.pathname === '/api/analytics') {
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(loadAnalytics(storePath), null, 2));
      return;
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Analytics UI: http://127.0.0.1:${actualPort}`);
    console.log(`Analytics store: ${storePath}`);
  });
}

try {
  start();
} catch (error: any) {
  console.error(`Failed to start analytics UI: ${error.message || error}`);
  process.exit(1);
}
