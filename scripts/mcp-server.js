#!/usr/bin/env node

/**
 * Neural Map — MCP Server (stub)
 *
 * Stdio JSON-RPC 2.0 server speaking MCP protocol version 2024-11-05.
 * Spawned by Claude Code as a child process per .mcp.json at plugin root.
 *
 * v0.3.0 step 3.1: handshake-only stub. tools/list returns []. tools/call
 * returns method-not-found. Step 3.2 will populate the real read tools.
 *
 * Wire protocol: line-delimited JSON-RPC. One complete JSON message per line
 * on stdin; one response line per request on stdout. Stdout is the protocol
 * channel — never write anything else there. Stderr is for errors only.
 *
 * Zero dependencies. Node stdlib only.
 */

const readline = require('readline');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'neural-map-mcp';
const SERVER_VERSION = '0.3.0';

// JSON-RPC error codes (per spec)
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id, error });
}

function logErr(...args) {
  process.stderr.write('[neural-map-mcp] ' + args.join(' ') + '\n');
}

// ---- Method handlers ----

function handleInitialize(id, _params) {
  sendResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  });
}

function handleToolsList(id, _params) {
  sendResult(id, { tools: [] });
}

function handleToolsCall(id, params) {
  const name = params && params.name ? params.name : '(unnamed)';
  // Stub: no tools registered yet. Return a tool-spec error result so a
  // calling client gets a structured response rather than a transport error.
  sendResult(id, {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Tool not found: ${name}. The Neural Map MCP server has no tools registered yet (v0.3.0 step 3.1 stub).`,
      },
    ],
  });
}

// ---- Dispatch ----

function dispatch(msg) {
  // Notifications have no id; they expect no response.
  const isNotification = msg.id === undefined || msg.id === null;
  const id = isNotification ? null : msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (isNotification) {
    // Accept and ignore the standard lifecycle notifications. Anything else
    // we still silently accept — notifications never get responses.
    if (method !== 'notifications/initialized' && method !== 'initialized') {
      logErr('unknown notification:', method);
    }
    return;
  }

  try {
    switch (method) {
      case 'initialize':
        return handleInitialize(id, params);
      case 'tools/list':
        return handleToolsList(id, params);
      case 'tools/call':
        return handleToolsCall(id, params);
      default:
        return sendError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (err) {
    logErr('handler threw for', method, '-', err && err.message ? err.message : err);
    sendError(id, INTERNAL_ERROR, 'Internal server error', { method });
  }
}

// ---- Line reader ----

const rl = readline.createInterface({
  input: process.stdin,
  output: undefined,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    // Per JSON-RPC spec, parse errors return id: null.
    sendError(null, PARSE_ERROR, 'Parse error');
    return;
  }

  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    const id = msg && (msg.id !== undefined) ? msg.id : null;
    sendError(id, INVALID_REQUEST, 'Invalid Request');
    return;
  }

  dispatch(msg);
});

rl.on('close', () => {
  // Stdin closed — Claude Code is shutting us down. Exit cleanly.
  process.exit(0);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
