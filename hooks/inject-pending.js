#!/usr/bin/env node

/**
 * Neural Map — UserPromptSubmit Hook
 *
 * Reads .claude/neural-map/pending.json (written by the writer server when
 * the user clicks Ask in the canvas). If a fresh pending request exists,
 * formats it as additionalContext so Claude sees it alongside the user's
 * terminal prompt.
 *
 * Designed to be aggressively fail-safe: any error path exits 0 with no
 * output. The user's prompt always proceeds normally even if this script
 * is broken.
 */

const fs = require('fs');
const path = require('path');

const STALENESS_MS = 5 * 60 * 1000; // 5 minutes
const SUPPORTED_VERSION = '0.2.0';

function main() {
  // Read the hook input from stdin. We don't actually need the input fields,
  // but reading is required so stdin doesn't stay open and stall the hook.
  let stdinRaw = '';
  try {
    stdinRaw = fs.readFileSync(0, 'utf8');
  } catch (err) {
    // No stdin? Continue. The cwd-from-env path below handles this.
  }

  let hookInput = {};
  try {
    if (stdinRaw) hookInput = JSON.parse(stdinRaw);
  } catch (err) {
    // Malformed input — not our problem, exit clean
    process.exit(0);
  }

  // The hook input includes `cwd` per the Claude Code hooks reference. Prefer
  // it over process.cwd() because hooks can run in unexpected working dirs.
  const cwd = hookInput.cwd || process.cwd();
  const pendingPath = path.join(cwd, '.claude', 'neural-map', 'pending.json');

  // Common case: no pending file. Silent no-op.
  if (!fs.existsSync(pendingPath)) {
    process.exit(0);
  }

  let raw;
  try {
    raw = fs.readFileSync(pendingPath, 'utf8');
  } catch (err) {
    // File disappeared between exists() and readFile() — race, exit clean.
    process.exit(0);
  }

  let pending;
  try {
    pending = JSON.parse(raw);
  } catch (err) {
    // Malformed — delete it and exit. Don't propagate corrupt context to Claude.
    safeDelete(pendingPath);
    process.exit(0);
  }

  // Schema check
  if (pending.version !== SUPPORTED_VERSION) {
    safeDelete(pendingPath);
    process.exit(0);
  }

  // Validate required fields. Anything missing → silent skip.
  if (typeof pending.question !== 'string' || pending.question.trim() === '') {
    safeDelete(pendingPath);
    process.exit(0);
  }
  if (!Array.isArray(pending.selection) || pending.selection.length === 0) {
    safeDelete(pendingPath);
    process.exit(0);
  }

  // Staleness check
  const createdAt = Date.parse(pending.createdAt);
  if (!isFinite(createdAt) || Date.now() - createdAt > STALENESS_MS) {
    // Older than 5 min — drop silently
    safeDelete(pendingPath);
    process.exit(0);
  }

  // Format the context
  const contextText = formatContext(pending);

  // Always delete pending BEFORE emitting context, so a hook crash post-emit
  // doesn't leave a stale file. Ordering: validate → delete → emit.
  safeDelete(pendingPath);

  // Emit the JSON output. Per the Claude Code hooks reference,
  // hookSpecificOutput.additionalContext is the right field for UserPromptSubmit.
  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: contextText
    }
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

function formatContext(pending) {
  const lines = [
    '[Neural Map canvas request]',
    '',
    'The user composed this question by selecting nodes in the project canvas:',
    '',
    `Question: ${pending.question.trim()}`,
    '',
    'Selected files:'
  ];

  for (const sel of pending.selection) {
    const name = sel.conceptName ? ` ("${sel.conceptName}")` : '';
    lines.push(`  - ${sel.path}${name}`);
  }

  lines.push('');
  lines.push("The user's terminal prompt may be a brief acknowledgment (e.g. 'ok', 'go') used to trigger this canvas request — treat the canvas question above as the actual ask, scoped to the selected files.");

  return lines.join('\n');
}

function safeDelete(p) {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    // best effort
  }
}

main();
