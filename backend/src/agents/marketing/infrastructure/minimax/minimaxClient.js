/**
 * Minimal MCP client using raw child_process stdio — no ESM required.
 * Spawns the minimax-coding-plan-mcp server and sends JSON-RPC messages over stdin/stdout.
 */
const { spawn } = require('child_process');

let serverProc = null;
let requestId = 0;
let pendingCalls = {};
let initPromise = null;

/**
 * Start the MCP server subprocess (idempotent — reuses existing process).
 * Only ONE initialization can be in flight at a time; all callers share the same promise.
 * @returns {Promise<ChildProcess>}
 */
async function startServer() {
  if (serverProc) return serverProc;
  if (initPromise) return initPromise;

  const API_KEY = process.env.MINIMAX_API_KEY || '';
  const API_HOST = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';

  initPromise = new Promise((resolveInit, rejectInit) => {
    const proc = spawn('uvx', ['minimax-coding-plan-mcp', '-y'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        MINIMAX_API_KEY: API_KEY,
        MINIMAX_API_HOST: API_HOST
      }
    });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const initId = ++requestId;

    const timeout = setTimeout(() => {
      proc.kill();
      initPromise = null;
      rejectInit(new Error(`MCP server startup timed out. stderr: ${stderr.slice(0, 500)}`));
    }, 30000);

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const raw of lines) {
        try {
          const msg = JSON.parse(raw);
          if (pendingCalls[msg.id]) {
            clearTimeout(timeout);
            const cb = pendingCalls[msg.id];
            delete pendingCalls[msg.id];
            cb.resolve(msg);
          }
        } catch (_) {}
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      initPromise = null;
      rejectInit(err);
    });

    proc.on('close', (code) => {
      serverProc = null;
      initPromise = null;
    });

    pendingCalls[initId] = {
      resolve: (msg) => {
        clearTimeout(timeout);
        serverProc = proc;
        proc.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {}
        }) + '\n');
        resolveInit(proc);
      },
      reject: (err) => {
        clearTimeout(timeout);
        initPromise = null;
        rejectInit(err);
      }
    };

    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'marketing-agent', version: '1.0.0' }
      }
    }) + '\n');
  });

  return initPromise;
}

/**
 * Call an MCP tool by name with arguments.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<any>}
 */
async function callTool(toolName, args) {
  const proc = await startServer();
  const id = ++requestId;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete pendingCalls[id];
      reject(new Error(`MCP tool "${toolName}" timed out after 60s`));
    }, 60000);

    pendingCalls[id] = { resolve, reject };

    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    }) + '\n');
  });
}

/**
 * Call the MiniMax web_search tool.
 * @param {string} query
 * @returns {Promise<{organic: Array, related_searches: Array, base_resp: object}>}
 */
async function callWebSearch(query) {
  const msg = await callTool('web_search', { query });
  const result = msg.result;
  const content = result && result.content;
  if (!content || !Array.isArray(content)) {
    console.warn('[Minimax MCP] result structure:', JSON.stringify(msg).slice(0, 500));
    throw new Error('web_search returned no content array');
  }
  const textBlock = content.find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    console.warn('[Minimax MCP] non-text blocks:', content.map(b => b.type).join(', '));
    throw new Error('web_search returned no text content');
  }
  return JSON.parse(textBlock.text);
}

/**
 * Gracefully stop the MCP server subprocess.
 */
async function closeMcpClient() {
  if (serverProc) {
    serverProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'shutdown' }) + '\n');
    serverProc.kill();
    serverProc = null;
  }
}

module.exports = { callWebSearch, closeMcpClient };