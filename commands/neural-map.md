---
description: Generate a Neural Map visualization of the current project — each file labeled with a concept name and metaphor.
allowed-tools: Bash, Read, Write
---

# Neural Map: Generate Project Visualization

You are generating a Neural Map for the current project. Follow these steps **in order**.

## Step 1: Scan the project

Run the scanner to get a list of recently-modified files:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/scan.js
```

The scanner outputs JSON to stdout containing the 30 most recently-modified text files in the project (excluding `node_modules`, `.git`, build outputs, and binaries). The shape is:

```json
{
  "projectName": "...",
  "projectRoot": "...",
  "scannedAt": "...",
  "fileCount": 30,
  "files": [/* per-file entries */]
}
```

Each entry in `output.files` has:

- `id` — stable 12-char hash of the relative path (use this verbatim, do not regenerate)
- `path` — relative path from project root
- `extension` — file extension
- `size` — bytes
- `modified` — ISO timestamp
- `preview` — first 500 chars of content
- `previewHash` — 8-char SHA1 of the preview (used for change detection)

## Step 2: Generate concepts for each file

For each file in the scanner output, generate a concept entry with this exact shape:

```json
{
  "id": "<id from scanner output — use verbatim, do not regenerate>",
  "path": "<path from scanner output>",
  "previewHash": "<previewHash from scanner output — use verbatim>",
  "conceptName": "<2-4 evocative words, Title Case, ≤24 characters total>",
  "metaphor": "<one short sentence — what this file IS, in plain language>",
  "category": "<one of: entry, logic, data, ui, config, style, test, doc>",
  "weight": <integer 1-5 indicating how central this file is to the project>,
  "connections": ["<id of related file>", "..."]
}
```

`id` and `previewHash` come from the scanner — copy them verbatim. Do not generate your own.

**Concept naming rules:**
- The `conceptName` is poetic-but-clear. Avoid generic names like "Auth Module" or "Database Schema" — those defeat the entire point of this plugin.
- **Hard length limit: 24 characters total.** SVG text doesn't wrap — names longer than 24 chars overflow the node visually. The viewer truncates defensively at render with an ellipsis, but plan inside the limit.
- The `metaphor` is one sentence, written *as if explaining to a curious non-coder*. NOT "Validates JWT tokens against the auth provider." YES "Checks IDs at the door before letting requests inside."
- Use the file's content (preview) AND its path to infer the role. A file named `auth.ts` containing JWT logic is "The Bouncer." A file named `auth.ts` containing a login UI is "The Front Desk."

**Concept name examples by category — use these as anchors for the *level* you're aiming for:**

| Category | File | Concept Name | Metaphor |
|---|---|---|---|
| entry | `src/main.tsx` | The Front Door | Where every visitor first walks in. |
| entry | `app/page.tsx` | The Lobby | The first room your users see. |
| logic | `middleware/auth.ts` | The Bouncer | Checks IDs at the door before letting requests inside. |
| logic | `services/payments.ts` | The Cashier | Counts the money and makes change. |
| data | `db/schema.sql` | The Memory Vault | Where everything the app remembers gets locked away. |
| data | `models/user.ts` | The Headshot | A passport photo for every user the system knows. |
| ui | `components/Header.tsx` | The Marquee | The big sign at the top that tells you where you are. |
| ui | `components/Card.tsx` | The Index Card | A small format the app uses to display anything once. |
| config | `tsconfig.json` | The House Rules | What the building inspector reads before signing off. |
| config | `vite.config.ts` | The Conductor | Tells the orchestra what order to play in. |
| style | `tailwind.config.js` | The Wardrobe | Every outfit the app is allowed to wear. |
| style | `theme.css` | Stage Lights | The mood the app is set in. |
| test | `auth.spec.ts` | The Inspector | Comes by once a week to check nothing's broken. |
| test | `e2e/checkout.test.ts` | The Dress Rehearsal | Walks through the whole show before opening night. |
| doc | `README.md` | The Welcome Mat | The first thing visitors read. |
| doc | `ARCHITECTURE.md` | The Blueprint | The drawings the contractors work from. |

These are anchors, not a lookup table. A new project will have files that don't match any of these — you're calibrating *the level of language*, not pattern-matching to fixed names.

**Category mapping:**
- `entry` — main entry points, top-level routes
- `logic` — business logic, services, controllers, middleware
- `data` — schemas, models, migrations, fixtures
- `ui` — components, pages, views
- `config` — config files, env, build config
- `style` — CSS, theme, design tokens
- `test` — test files
- `doc` — markdown, READMEs, specs

**Weight rule:**
- 5 = central — the project doesn't make sense without this file
- 3 = important supporting file
- 1 = peripheral utility

**Connections:**
- For each file, identify 1–3 other files it directly relates to (imports, references, extends). Use their `id` values.

## Step 3: Merge with existing state

If `.claude/neural-map/state.json` already exists, read it. Otherwise, treat existing state as `{ nodes: [] }`.

**Merge rules — apply per file from the scanner output:**

For each scanner entry, look up the existing node by `id`:

1. **No existing node (new file):** generate the full concept entry from scratch, including `conceptName`, `metaphor`, `category`, `weight`, `connections`.
2. **Existing node, `previewHash` matches scanner's `previewHash`:** the file's content is materially unchanged. **Preserve the existing `conceptName`, `metaphor`, `category`, and `weight` verbatim.** Update only `path` (in case of rename), `modified`, `previewHash` (same value), and `connections` (which can shift as the project's other files change).
3. **Existing node, `previewHash` differs:** the file has materially changed. Regenerate `conceptName`, `metaphor`, `category`, `weight`, and `connections` from scratch — the previous concept may no longer fit.

For nodes in existing state whose `id` doesn't appear in the current scan (file deleted or no longer in the recent-30): set `archived: true` rather than removing the entry. Don't generate concepts for archived nodes.

**Why this matters:** the `conceptName` is the user's mental anchor. If "The Bouncer" silently becomes "The Gatekeeper" between two runs with no code change, the user loses trust in every name in the map. The `previewHash` check makes name stability a property of the system, not a hopeful behavior.

The state file shape:

```json
{
  "version": "0.1.0",
  "generated": "<ISO timestamp>",
  "projectName": "<directory name of cwd>",
  "nodes": [/* concept entries, including any archived ones */]
}
```

## Step 4: Write the state file

Use the Write tool to save the merged state to `.claude/neural-map/state.json`. Create the directory if it doesn't exist.

## Step 5: Render the viewer

The viewer template lives at `${CLAUDE_PLUGIN_ROOT}/viewer/template.html` and contains the literal token `__NEURAL_MAP_STATE__` where state should be inlined. To produce a working viewer for this project:

1. **Read** the template: `Read ${CLAUDE_PLUGIN_ROOT}/viewer/template.html`
2. **Serialize** the merged state from Step 4 to a JSON string. **Then escape every occurrence of `</` to `<\/` in that string.** This is required, not optional — any preview field containing `</script>` (which will happen on any project with HTML or JS source files) will close the inline `<script>` tag prematurely and the viewer will load empty. The escape is a single string replacement before token substitution.
3. **Replace** the token `__NEURAL_MAP_STATE__` with the escaped JSON string. Use a single global replacement; the token only appears once.
4. **Write** the result to `.claude/neural-map/index.html` in the user's project (NOT in the plugin folder). This is the per-project rendered file.

Use the Write tool for step 4. Create the directory if it doesn't exist (it should already exist from the state.json write earlier).

> **Why the `</` escape is non-negotiable:** the JSON sits inside a `<script>` tag in the rendered HTML. The browser's HTML parser, not the JS parser, decides where the script tag ends. It looks for the literal substring `</script` (case-insensitive, in any context including string literals). Escaping `</` to `<\/` is invisible to the JSON parser (since `\/` is a legal JSON escape for `/`) but breaks the HTML parser's match. This is a well-known XSS-adjacent footgun. Skip the escape and the viewer fails silently on most real projects.

## Step 6: Open the rendered viewer

The path here is **the user's project**, not the plugin root. Use `.claude/neural-map/index.html` relative to the user's cwd.

```bash
# macOS
open .claude/neural-map/index.html

# Linux fallback
# xdg-open .claude/neural-map/index.html

# Windows fallback
# start .claude/neural-map/index.html
```

Detect the OS first and pick the right command. If `open` fails, try `xdg-open`, then `start`.

> **Why this path matters:** opening `${CLAUDE_PLUGIN_ROOT}/viewer/template.html` would show the user the unrendered template with the literal string `__NEURAL_MAP_STATE__` in it. The rendered file in the user's project is the only viewer they should ever see.

## Step 7: Tell the user what you did

Report briefly:
- How many files you mapped
- A few of the most interesting concept names you generated (2-3 examples)
- The path to the state file
- That the viewer should now be open in their browser

Do NOT dump the full state.json contents into the chat. The viewer is the output, not the chat.
