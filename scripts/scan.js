#!/usr/bin/env node

/**
 * Neural Map — Project Scanner
 *
 * Walks the current working directory, returns the 30 most recently-modified
 * text files as JSON on stdout. Excludes node_modules, .git, build outputs,
 * binaries, and lock files.
 *
 * Output is consumed by the /neural-map slash command.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- Configuration ----

const MAX_FILES = 30;
const PREVIEW_BYTES = 500;

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  '.cache', '.vscode', '.idea', 'coverage', '.turbo',
  '__pycache__', '.pytest_cache', 'venv', '.venv',
  'DerivedData', 'Pods', '.expo',
  // iOS / Xcode conventions: case-sensitive matching means we need the
  // capital-B variants explicitly. Xcode rebuilds touch hundreds of files
  // in Build/Intermediates.noindex/ on every build, and without these
  // entries they steal slots in the recency-sorted top-30 from real source.
  'Build', 'Intermediates.noindex', 'xcuserdata',
  '.claude' // MVP: exclude .claude entirely; revisit in Phase 2 if user CLAUDE.md inclusion matters
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Podfile.lock', 'Gemfile.lock', 'poetry.lock',
  '.DS_Store', 'Thumbs.db'
]);

// Files matched by exact name rather than extension.
// These either have no extension (Dockerfile, LICENSE) or are dotfile-as-name
// where path.extname() returns '' (.gitignore) or the wrong thing (.env.example).
const INCLUDE_FILENAMES = new Set([
  '.gitignore', '.dockerignore', '.npmrc', '.nvmrc', '.editorconfig',
  '.prettierrc', '.eslintrc',
  'Dockerfile', 'Makefile', 'LICENSE', 'Procfile', 'README', 'CHANGELOG'
]);

// Dotfolders that are real source directories, not tooling artifacts.
// The walk() default is to skip any directory starting with `.` (catches
// .vscode, .idea, .turbo, .DS_Store-adjacent junk, etc.). This set is the
// allowlist for dotfolders we DO want to walk into.
// MVP: just .claude-plugin (the manifest dir for this plugin and any plugin
// the user is building). Revisit in Phase 2 if users request .github, etc.
const ALLOWED_DOTFOLDERS = new Set([
  '.claude-plugin'
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.md', '.mdx', '.txt', '.rst',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.prisma', '.proto',
  '.vue', '.svelte', '.astro'
]);

// ---- Walking ----

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return; // permission denied, skip silently
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && !ALLOWED_DOTFOLDERS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name);
      const matchesExt = TEXT_EXTENSIONS.has(ext);
      const matchesName = INCLUDE_FILENAMES.has(entry.name);
      const matchesEnv = entry.name.startsWith('.env');
      if (!matchesExt && !matchesName && !matchesEnv) continue;
      yield full;
    }
  }
}

// ---- File metadata ----

function makeId(relativePath) {
  return crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 12);
}

function readPreview(absPath) {
  try {
    const fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(PREVIEW_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, PREVIEW_BYTES, 0);
    fs.closeSync(fd);
    const text = buf.slice(0, bytesRead).toString('utf8');
    // Drop anything past the first null byte (binary contamination guard).
    // Use String.fromCharCode(0) rather than the '\u0000' literal — markdown
    // → code-writer pipelines (Cursor's Write tool, some agents) can process
    // the unicode escape into an actual NUL byte during spec materialization,
    // which silently breaks the indexOf check.
    const NUL = String.fromCharCode(0);
    const nullIdx = text.indexOf(NUL);
    return nullIdx === -1 ? text : text.slice(0, nullIdx);
  } catch (err) {
    return '';
  }
}

function describe(absPath, root) {
  const stat = fs.statSync(absPath);
  // Normalize to forward slashes so IDs and displayed paths are platform-stable
  // (matters for cross-platform state.json diffs and viewer display)
  const rel = path.relative(root, absPath).split(path.sep).join('/');
  const preview = readPreview(absPath);
  const previewHash = crypto.createHash('sha1').update(preview).digest('hex').slice(0, 8);
  return {
    id: makeId(rel),
    path: rel,
    extension: path.extname(rel),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    preview,
    previewHash
  };
}

// ---- Main ----

function main() {
  const root = process.cwd();
  const files = [];

  for (const abs of walk(root)) {
    try {
      files.push(describe(abs, root));
    } catch (err) {
      // skip files we can't stat
    }
  }

  // Most recently modified first, capped at MAX_FILES
  files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  const top = files.slice(0, MAX_FILES);

  const output = {
    projectName: path.basename(root),
    projectRoot: root,
    scannedAt: new Date().toISOString(),
    fileCount: top.length,
    files: top
  };

  process.stdout.write(JSON.stringify(output, null, 2));
}

main();