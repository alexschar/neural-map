#!/usr/bin/env node

/**
 * Neural Map — MCP Server
 *
 * Stdio JSON-RPC 2.0 server speaking MCP protocol version 2024-11-05.
 * Spawned by Claude Code as a child process per .mcp.json at plugin root.
 *
 * v0.3.0 step 3.2: read tools (get_concept, list_concepts, get_world_metaphor)
 * read .claude/neural-map/state.json from the user's project (process.cwd()).
 *
 * Wire protocol: line-delimited JSON-RPC. One complete JSON message per line
 * on stdin; one response line per request on stdout. Stdout is the protocol
 * channel — never write anything else there. Stderr is for errors only.
 *
 * Zero dependencies. Node stdlib only.
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

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

// ---- Tool definitions ----

const TOOLS = [
  {
    name: 'get_concept',
    description:
      "Look up a concept in the project's Neural Map by its evocative name (e.g. 'The Doorman', 'The Foundation') or its file path (e.g. 'src/auth.ts'). Use this when the user references a part of their project by its concept name and you need the underlying file path, the metaphor sentence explaining what the file does, the category (entry/logic/data/ui/config/style/test/doc), or how central the file is to the project. Returns null if no concept matches.",
    inputSchema: {
      type: 'object',
      properties: {
        name_or_path: {
          type: 'string',
          description:
            "Either a concept name (case-insensitive, e.g. 'the doorman') or an exact file path (e.g. 'middleware/auth.ts').",
        },
      },
      required: ['name_or_path'],
    },
  },
  {
    name: 'list_concepts',
    description:
      "List every concept in the project's Neural Map. Use this when the user asks broad questions about their project's shape, what's in it, what the central files are, or how files relate. Returns the project name, world metaphor, and an array of all non-archived concept entries (each with id, conceptName, metaphor, path, category, weight, connections).",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_world_metaphor',
    description:
      "Get the single extended metaphor (the 'world') the project is mapped as — for example 'a house', 'a car', 'a kitchen'. Use this when the user asks what world their project is, or when you need to know the metaphor frame to interpret concept names like 'The Doorman' or 'The Foundation'. Also returns the project name.",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

// ---- State loading ----
//
// state.json lives in the user's project, not the plugin root. Claude Code
// spawns the MCP server with cwd set to the project the user is working in.
// We re-read on every tool call: the canvas (and Step 3.3's mark_central) may
// have written new state since the last call.

function statePath() {
  return path.join(process.cwd(), '.claude', 'neural-map', 'state.json');
}

function toolErr(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function toolOk(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

function toolText(text) {
  return { content: [{ type: 'text', text }] };
}

function loadState() {
  const p = statePath();
  if (!fs.existsSync(p)) {
    return {
      err: toolErr(
        'No Neural Map exists for this project yet. Run /neural-map:map in your Claude Code session to generate one.'
      ),
    };
  }
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    return {
      err: toolErr('state.json could not be read: ' + (err.message || String(err))),
    };
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    return {
      err: toolErr('state.json is malformed. Re-run /neural-map:map to regenerate.'),
    };
  }
  return { state };
}

function nonArchived(nodes) {
  return (nodes || []).filter((n) => !n.archived);
}

// ---- Tool implementations ----

function toolGetConcept(args) {
  const query = args && args.name_or_path;
  if (typeof query !== 'string' || query.length === 0) {
    return toolErr("get_concept requires a 'name_or_path' string argument.");
  }
  const { state, err } = loadState();
  if (err) return err;
  const candidates = nonArchived(state.nodes);
  const byPath = candidates.find((n) => n.path === query);
  if (byPath) return toolOk(byPath);
  const lower = query.toLowerCase();
  const byName = candidates.find(
    (n) => typeof n.conceptName === 'string' && n.conceptName.toLowerCase() === lower
  );
  if (byName) return toolOk(byName);
  return toolText(`No concept matches '${query}'.`);
}

function toolListConcepts(_args) {
  const { state, err } = loadState();
  if (err) return err;
  return toolOk({
    projectName: state.projectName,
    worldMetaphor: state.worldMetaphor,
    concepts: nonArchived(state.nodes),
  });
}

function toolGetWorldMetaphor(_args) {
  const { state, err } = loadState();
  if (err) return err;
  if (!state.worldMetaphor) {
    return toolText(
      'This Neural Map was generated before v0.2 (no world metaphor was assigned). Run /neural-map:map to regenerate with a world metaphor.'
    );
  }
  return toolOk({
    projectName: state.projectName,
    worldMetaphor: state.worldMetaphor,
  });
}

const TOOL_HANDLERS = {
  get_concept: toolGetConcept,
  list_concepts: toolListConcepts,
  get_world_metaphor: toolGetWorldMetaphor,
};

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
  sendResult(id, { tools: TOOLS });
}

function handleToolsCall(id, params) {
  const name = params && params.name ? params.name : '(unnamed)';
  const args = (params && params.arguments) || {};
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    sendResult(id, toolErr(`Tool not found: ${name}.`));
    return;
  }
  try {
    sendResult(id, handler(args));
  } catch (err) {
    logErr('tool', name, 'threw -', err && err.message ? err.message : err);
    sendResult(id, toolErr(`Tool '${name}' failed: ${err && err.message ? err.message : 'unknown error'}`));
  }
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
