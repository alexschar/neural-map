---
description: Generate a Neural Map visualization of the current project — each file labeled as a role in a single project-level metaphor.
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

## Step 2: Pick or carry-forward the project's world metaphor

Read `.claude/neural-map/state.json` if it exists.

**If state.json exists AND has a non-empty `worldMetaphor` field:** use it verbatim. Do not re-pick. Skip to Step 3 with the existing world. This is the stability promise — names don't shake between runs.

**If state.json doesn't exist, or has no `worldMetaphor`:** pick one extended metaphor that the whole project will be named within. Write it as a single short phrase, like `"a theater production"` or `"a working kitchen"` or `"a starship in flight"`. Look at the file paths and the previews together to choose a world that has natural roles for the kinds of files present (entry points, business logic, data, UI, config, style, tests, docs).

**World selection rules:**
- Pick a world rich enough to have ~30 distinct natural roles. A theater has stage, lobby, box office, dressing room, marquee, lighting, props, ushers, the program, the dress rehearsal, the director's notes, the playbill — that's enough range. A "thermos" or "single shopping bag" wouldn't be.
- Pick something concrete and physically inhabitable. The user is going to think *spatially* about their project. A "weather system" is weak (where's the entry point?). A "newspaper office" is strong (front desk, the press room, the morgue, the editor's desk).
- Don't try to match the project's literal domain. A music app does NOT need to be a "concert hall." Pick the world that has the best *roles*, not the closest theme. A theater works for almost anything.
- Avoid worlds that map awkwardly to data files. If you're tempted to name a database schema "the moon" or "the wind" because your world is celestial, the world is wrong — pick a different one.

**Anchor worlds — pick from these unless you have a strong reason to invent a new one:**

| World | Strong for | Example roles available |
|---|---|---|
| `a theater production` | most projects | stage, lobby, marquee, box office, dressing room, props, ushers, program, dress rehearsal, director's notes |
| `a working kitchen` | data-heavy, async | walk-in, pantry, line, expediter, dish pit, ticket window, chef's notes, mise en place |
| `a working newsroom` | content/CMS | front page, the wire, copy desk, fact-check, the morgue (archive), beat reporters, masthead |
| `a starship in flight` | engineering-heavy | bridge, engine room, airlock, computer core, life support, comms, captain's log |
| `a hotel front-of-house` | request/response | lobby, concierge, front desk, switchboard, housekeeping, room service, the safe |
| `a small museum` | docs/reference | front entrance, exhibit halls, the gift shop, conservation lab, the catalog, docent notes |
| `a working farm` | scheduled/cron | barn, field, greenhouse, silo, packing shed, the almanac, the chicken coop |
| `a film set` | build pipelines | sound stage, craft services, wardrobe, the gaffer's truck, the dailies, the script |

Once chosen, the world goes in `state.json` as:

```json
{
  "worldMetaphor": "a theater production",
  ...
}
```

## Step 3: Generate concepts for each file as a role within the world

For each file in the scanner output, generate a concept entry with this exact shape:

```json
{
  "id": "<id from scanner output — use verbatim, do not regenerate>",
  "path": "<path from scanner output>",
  "size": <size from scanner output>,
  "modified": "<modified from scanner output>",
  "previewHash": "<previewHash from scanner output — use verbatim>",
  "conceptName": "<2-4 evocative words, Title Case, ≤24 characters total>",
  "metaphor": "<one short sentence — what role this file plays in the chosen world>",
  "category": "<one of: entry, logic, data, ui, config, style, test, doc>",
  "weight": <integer 1-5 indicating how central this file is to the project>,
  "connections": ["<id of related file>", "..."]
}
```

`id`, `previewHash`, `size`, and `modified` come from the scanner — copy them verbatim. Do not generate your own.

> **Why `size` and `modified` now appear in the concept entry:** the viewer reads them when populating the detail panel. v0.1 dropped these during merge, which is why the SIZE field showed an em dash. v0.2 fixes this by carrying them through.

**Concept naming rules:**

- The `conceptName` is poetic-but-clear, **and belongs to the chosen world**. Every name in the project must be a role within `worldMetaphor`. Do not mix worlds. If `worldMetaphor` is "a theater production," every name comes from the theater — no kitchen roles, no spaceship roles.
- **Hard length limit: 24 characters total.** SVG text doesn't wrap — names longer than 24 chars overflow the node. The viewer truncates defensively at render with an ellipsis.
- The `metaphor` is one sentence that places this file *within the chosen world*. NOT "Validates JWT tokens against the auth provider." YES (in the theater world) "Checks tickets at the door before guests reach their seats." The metaphor sentence reads like a tour guide pointing at this part of the building.
- Use the file's content (preview) AND its path to infer the role. A file named `auth.ts` containing JWT logic is "The Usher" in a theater. The same file containing a login UI is "The Box Office Window."

**Concept name examples by category — three full example sets in three different worlds. Use these as anchors for the *level* of language and the *cohesion* you're aiming for.**

### World: a theater production

| Category | File | Concept Name | Metaphor |
|---|---|---|---|
| entry | `src/main.tsx` | The House Lights | When the theater opens its doors for the night. |
| entry | `app/page.tsx` | The Lobby | The first room your audience steps into. |
| logic | `middleware/auth.ts` | The Usher | Checks tickets before letting people into the seats. |
| logic | `services/payments.ts` | The Box Office | Where every transaction at the door is handled. |
| data | `db/schema.sql` | The Archive Room | Where every program from every show is filed. |
| data | `models/user.ts` | The Patron Card | What the theater remembers about each ticket-holder. |
| ui | `components/Header.tsx` | The Marquee | The lit-up sign above the entrance. |
| ui | `components/Card.tsx` | The Playbill | A small format the theater uses for any production. |
| config | `tsconfig.json` | The House Rules | The codes the building inspector signs off on. |
| config | `vite.config.ts` | The Stage Manager | Coordinates who moves what when. |
| style | `tailwind.config.js` | The Costume Closet | Every outfit any actor is allowed to wear. |
| style | `theme.css` | Stage Lighting | The mood every scene gets bathed in. |
| test | `auth.spec.ts` | The Dress Rehearsal | A full run before opening night to catch what's broken. |
| test | `e2e/checkout.test.ts` | Tech Week | Every system tested before paying audiences arrive. |
| doc | `README.md` | The Program | What every audience member reads before the show starts. |
| doc | `ARCHITECTURE.md` | Director's Notes | The script the production was actually built from. |

### World: a working kitchen

| Category | File | Concept Name | Metaphor |
|---|---|---|---|
| entry | `src/main.tsx` | The Service Window | Where every order enters the kitchen. |
| logic | `middleware/auth.ts` | The Expediter | Checks every ticket before it goes to the line. |
| logic | `services/payments.ts` | The Cashier | Where the bill gets settled at the end of the meal. |
| data | `db/schema.sql` | The Walk-In | Where every ingredient and recipe is stored cold. |
| data | `models/user.ts` | The Regular's Card | What the kitchen remembers about each diner. |
| ui | `components/Header.tsx` | The Chalkboard | What's on offer tonight, written above the pass. |
| ui | `components/Card.tsx` | The Order Ticket | The standard format every order is written on. |
| config | `tsconfig.json` | The Health Code | The rules the inspector checks every visit. |
| style | `theme.css` | The Atmosphere | Soft lighting, warm music, the mood the room is set in. |
| test | `auth.spec.ts` | The Tasting | The chef tries every dish before service begins. |
| doc | `README.md` | The Menu | What every guest looks at first. |
| doc | `ARCHITECTURE.md` | The Mise en Place | What was prepped before service to make everything work. |

### World: a starship in flight

| Category | File | Concept Name | Metaphor |
|---|---|---|---|
| entry | `src/main.tsx` | The Airlock | The only way aboard the ship. |
| logic | `middleware/auth.ts` | Security Clearance | Verifies credentials at the airlock. |
| logic | `services/payments.ts` | The Quartermaster | Logs every supply transaction in the ledger. |
| data | `db/schema.sql` | The Computer Core | The ship's long-term memory bank. |
| ui | `components/Header.tsx` | The Bridge HUD | What the captain reads during every shift. |
| config | `tsconfig.json` | Operations Manual | The protocols every crew member is trained on. |
| style | `theme.css` | Running Lights | The visual personality of the hull at night. |
| test | `auth.spec.ts` | Pre-Flight Check | Every system tested before launch. |
| doc | `README.md` | Welcome Aboard | First thing handed to new crew. |
| doc | `ARCHITECTURE.md` | The Schematics | The blueprints engineering works from. |

These are anchors, not lookup tables. Your project will have files that don't match these examples one-for-one — you're calibrating the *level of language* AND the *cohesion of the world*, not pattern-matching to fixed names.

**Category mapping (unchanged from v0.1):**
- `entry` — main entry points, top-level routes
- `logic` — business logic, services, controllers, middleware
- `data` — schemas, models, migrations, fixtures
- `ui` — components, pages, views
- `config` — config files, env, build config
- `style` — CSS, theme, design tokens
- `test` — test files
- `doc` — markdown, READMEs, specs

**Weight rule (unchanged):**
- 5 = central — the project doesn't make sense without this file
- 3 = important supporting file
- 1 = peripheral utility

**Connections (unchanged):**
- For each file, identify 1–3 other files it directly relates to (imports, references, extends). Use their `id` values.

## Step 4: Merge with existing state

If `.claude/neural-map/state.json` already exists, read it. Otherwise treat existing state as `{ worldMetaphor: "<from Step 2>", nodes: [] }`.

**Merge rules — apply per file from the scanner output:**

For each scanner entry, look up the existing node by `id`:

1. **No existing node (new file):** generate the full concept entry from scratch within the locked world.
2. **Existing node, `previewHash` matches scanner's `previewHash`:** the file's content is materially unchanged. **Preserve the existing `conceptName`, `metaphor`, `category`, and `weight` verbatim.** Update `path` (in case of rename), `size`, `modified`, `previewHash` (same value), and `connections`.
3. **Existing node, `previewHash` differs:** the file has materially changed. Regenerate `conceptName`, `metaphor`, `category`, `weight`, and `connections` — but the new name must still be a role within the **locked** `worldMetaphor`. The world doesn't change; the role within it can.

For nodes in existing state whose `id` doesn't appear in the current scan: set `archived: true` rather than removing the entry.

**Why this matters:** the user's mental anchor is the combination of `worldMetaphor + conceptName`. Both must be stable across runs for unchanged files. v0.1's `previewHash` check made names stable. v0.2's `worldMetaphor` carry-forward makes the *world* stable. Together they're the trust contract.

The state file shape (note the new top-level `worldMetaphor` and `version` bump):

```json
{
  "version": "0.2.0",
  "generated": "<ISO timestamp>",
  "projectName": "<directory name of cwd>",
  "worldMetaphor": "<chosen or carried-forward world>",
  "nodes": [/* concept entries, including any archived ones */]
}
```

## Step 5: Write the state file

Use the Write tool to save the merged state to `.claude/neural-map/state.json`. Create the directory if it doesn't exist.

## Step 6: Render the viewer

The viewer template lives at `${CLAUDE_PLUGIN_ROOT}/viewer/template.html` and contains the literal token `__NEURAL_MAP_STATE__` where state should be inlined. To produce a working viewer:

1. **Read** the template: `Read ${CLAUDE_PLUGIN_ROOT}/viewer/template.html`
2. **Serialize** the merged state from Step 5 to a JSON string. **Then escape every occurrence of `</` to `<\/` in that string.** This is required, not optional — any preview field containing `</script>` will close the inline `<script>` tag prematurely.
3. **Replace** the token `__NEURAL_MAP_STATE__` with the escaped JSON string.
4. **Write** the result to `.claude/neural-map/index.html` in the user's project (NOT in the plugin folder).

> **Why the `</` escape is non-negotiable:** the JSON sits inside a `<script>` tag. The HTML parser, not the JS parser, decides where the script tag ends. It looks for the literal substring `</script` (case-insensitive, anywhere). Escaping `</` to `<\/` is invisible to the JSON parser (since `\/` is a legal JSON escape for `/`) but breaks the HTML parser's match.

## Step 7: Restart the writer server

The writer server is the bridge that lets the canvas write pending requests to disk. The viewer fetches `http://localhost:3737` to send selections + questions; the server writes them to `.claude/neural-map/pending.json`; the UserPromptSubmit hook reads that file on the user's next prompt.

Before opening the viewer, restart the writer server so the latest version runs:

```bash
# Kill any prior server instance using its PID file
if [ -f .claude/neural-map/server.pid ]; then
  kill "$(cat .claude/neural-map/server.pid)" 2>/dev/null || true
  rm -f .claude/neural-map/server.pid
fi

# Spawn fresh server, detached so it survives the slash command exiting
nohup node "${CLAUDE_PLUGIN_ROOT}/scripts/writer-server.js" \
  > .claude/neural-map/server.log 2>&1 &
echo $! > .claude/neural-map/server.pid
disown 2>/dev/null || true
```

The server runs zero-dep Node, listens on `localhost:3737`, and accepts only `POST /pending` and `GET /health`. Full spec in `09-writer-server.md`.

> **Why detached:** the slash command terminates after returning. If the server were a child of the slash command's process tree it would die with it. `nohup ... &` plus `disown` decouples it from the terminal session so it survives.

## Step 8: Open the rendered viewer

```bash
# macOS
open .claude/neural-map/index.html

# Linux fallback
# xdg-open .claude/neural-map/index.html

# Windows fallback
# start .claude/neural-map/index.html
```

Detect OS and pick the right command. Path is **the user's project**, not the plugin root.

## Step 9: Tell the user what you did

Report briefly:
- The chosen `worldMetaphor` (e.g. "Mapped as a theater production")
- Whether it was newly picked or carried forward from a prior run
- How many files were mapped, plus 2–3 of the most interesting role names
- That the viewer is open and the Ask button is wired to inject prompts on next terminal turn
- The path to `state.json`

Do NOT dump the full state.json contents into the chat. The viewer is the output.
