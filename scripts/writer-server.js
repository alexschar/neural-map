#!/usr/bin/env node

/**
 * Neural Map — Writer Server
 *
 * Tiny localhost HTTP server. Accepts canvas POSTs and writes them to
 * .claude/neural-map/pending.json so the UserPromptSubmit hook can read
 * them on the user's next terminal prompt.
 *
 * Lifecycle: spawned detached by the /neural-map:map slash command.
 * PID written to .claude/neural-map/server.pid. Next slash command run kills
 * the prior PID and respawns.
 *
 * Zero dependencies. Built-in http and fs modules only.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3737;
const HOST = '127.0.0.1'; // explicitly bind localhost only — never 0.0.0.0

const CWD = process.cwd();
const STATE_DIR = path.join(CWD, '.claude', 'neural-map');
const PENDING_PATH = path.join(STATE_DIR, 'pending.json');
const PID_PATH = path.join(STATE_DIR, 'server.pid');

// ---- CORS preflight handling ----
// The viewer is loaded via file://, which means cross-origin to http://localhost.
// We accept requests from any origin because the server only binds to 127.0.0.1
// — only processes on this machine can reach it anyway.
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ---- Request body parsing ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const MAX_BYTES = 256 * 1024; // 256 KB cap — pending payloads are tiny
    req.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---- Pending payload validation ----
// Schema is the contract with the hook (see 11-prompt-bridge-hook.md).
// Reject anything that doesn't match — better to surface a clear error to the
// canvas than write a malformed file the hook will skip silently.
function validatePending(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'payload must be an object';
  }
  if (typeof payload.question !== 'string' || payload.question.trim() === '') {
    return 'question must be a non-empty string';
  }
  if (payload.question.length > 4000) {
    return 'question must be ≤4000 characters';
  }
  if (!Array.isArray(payload.selection) || payload.selection.length === 0) {
    return 'selection must be a non-empty array';
  }
  if (payload.selection.length > 30) {
    return 'selection must contain ≤30 entries';
  }
  for (const entry of payload.selection) {
    if (!entry || typeof entry !== 'object') {
      return 'each selection entry must be an object';
    }
    if (typeof entry.id !== 'string' || typeof entry.path !== 'string') {
      return 'each selection entry must have string id and path';
    }
    // conceptName is optional in the request — server fills it as null if missing
  }
  return null; // valid
}

// ---- Routes ----
function handlePending(req, res) {
  readBody(req)
    .then(raw => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      const validationError = validatePending(payload);
      if (validationError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: validationError }));
        return;
      }

      // Normalize: the file the hook reads has a fixed shape with createdAt
      // baked in by the server, not trusted from the client.
      const pending = {
        version: '0.2.0',
        createdAt: new Date().toISOString(),
        question: payload.question,
        selection: payload.selection.map(entry => ({
          id: entry.id,
          path: entry.path,
          conceptName: entry.conceptName || null
        }))
      };

      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        // Atomic-ish write: write to .tmp, rename. Avoids the hook reading a
        // half-written file if it fires mid-write (unlikely but cheap to prevent).
        const tmpPath = PENDING_PATH + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(pending, null, 2));
        fs.renameSync(tmpPath, PENDING_PATH);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to write pending: ' + err.message }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, createdAt: pending.createdAt }));
    })
    .catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
}

function handleHealth(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, port: PORT, cwd: CWD }));
}

// ---- Server ----
const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/pending') {
    handlePending(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    handleHealth(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    // The slash command tries to kill any prior server before spawning.
    // If we still hit EADDRINUSE, log and exit — the canvas will surface
    // a clear error to the user via the /health probe.
    console.error(`Port ${PORT} already in use. Another writer-server is running.`);
    process.exit(1);
  }
  console.error('Server error:', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Neural Map writer-server listening on http://${HOST}:${PORT}`);
});

// ---- Cleanup on exit ----
function cleanup() {
  try {
    if (fs.existsSync(PID_PATH)) {
      // Only delete the pid file if it points to us — avoid deleting a
      // newer server's pid file if we're a stale instance being killed.
      const recordedPid = parseInt(fs.readFileSync(PID_PATH, 'utf8').trim(), 10);
      if (recordedPid === process.pid) {
        fs.unlinkSync(PID_PATH);
      }
    }
  } catch (err) {
    // best-effort
  }
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
