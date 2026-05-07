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

**If state.json doesn't exist, or has no `worldMetaphor`:** pick one extended metaphor that the whole project will be named within. Write it as a single short phrase. Look at the file paths and the previews together to choose a world that has natural roles for the kinds of files present (entry points, business logic, data, UI, config, style, tests, docs).

**World choice — bias toward universal.** The right world is one any user can immediately picture without referencing a hobby, genre, or career. Strong default choices, in rough preference order:

1. **A house** — works for almost any project. Strong universal vocabulary (front door, foundation, wiring, walls, lighting, inspector).
2. **A car** — works for any project with a clear "user → result" flow. Strong universal vocabulary (ignition, dashboard, steering, brakes, engine, mirrors).
3. **A kitchen / a restaurant** — best for projects where data flows through preparation stages.
4. **The human body** — best for projects where every part has a clear role keeping the whole alive.
5. **A garden** — best for slow-growing, content-heavy, or curated projects.
6. **A workshop** — best for tooling, build systems, dev tools.

Acceptable when a project has a shape that genuinely fits:
- A theater (clear stage / backstage / audience separation)
- A city (many distinct districts of functionality)
- A train station, a port (things move through stages)

Avoid genre-specific worlds — they alienate users who don't share the frame:
- A starship, a space station (sci-fi)
- A castle, a royal court (fantasy)
- A heist, a spy operation (caper genre)
- A laboratory, a hospital (biases the metaphor toward sterile/clinical and kills warmth)

When unsure, pick **a house**. It works for almost any project.

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

**Metaphor sentence formula — bridge the metaphor to the function.** The metaphor sentence does two jobs at once:

1. Place the file as a part of the chosen world (the spatial anchor)
2. Tell the user what the file actually does (the function anchor)

Default pattern: **"The [metaphor role] of your [code base / app / project] — [plain-language description of what the file does, using metaphor vocabulary where natural]."**

✅ GOOD: "The doorman of your app — checks every visitor's keys before letting them past the foyer."
✅ GOOD: "The steering wheel of your app — decides which page the user lands on next based on the URL."
❌ BAD (pure metaphor, no function anchor): "Checks tickets at the door."
❌ BAD (pure function, no metaphor anchor): "Validates JWT tokens against the auth provider."

The metaphor is a **hook**. The function is the **payload**. A good metaphor sentence delivers both. Variation in sentence shape is fine for rhythm — you don't have to lead with "The X of your app" every time — but the bridge between metaphor and function must always be present.

**Concept name examples by category — three full example sets in three different worlds. Use these as anchors for the *level* of language and the *cohesion* you're aiming for.**

### World: a house

| Category | File | Concept Name | Metaphor |
|---|---|---|---|
| entry | `src/main.tsx` | The Front Door | The front door of your app — every visitor walks through here before reaching anything else. |
| entry | `app/page.tsx` | The Foyer | The foyer of your app — the first room a visitor sees, where the rest of the house branches off. |
| logic | `middleware/auth.ts` | The Doorman | The doorman of your app — checks every visitor's keys before letting them past the foyer. |
| logic | `services/payments.ts` | The Cashbox | The cashbox of your app — every transaction in the house gets counted and locked away here. |
| data | `db/schema.sql` | The Foundation | The foundation of your app — what every saved fact in the house is built on top of. |
| data | `models/user.ts` | The Family Album | The family album of your app — the standing record of who lives here and how they're known. |
| ui | `components/Header.tsx` | The Mantelpiece | The mantelpiece of your app — the strip across the top that announces whose house this is. |
| ui | `components/Card.tsx` | The Picture Frame | The picture frame of your app — a standard shape the house uses to display anything once. |
| config | `tsconfig.json` | The Building Code | The building code of your app — the rules every contractor reads before driving a single nail. |
| config | `vite.config.ts` | The Wiring Plan | The wiring plan of your app — tells the build tools which cables connect to what. |
| style | `tailwind.config.js` | The Paint Palette | The paint palette of your app — every color the house is allowed to wear, listed once for everyone. |
| style | `theme.css` | The Lighting | The lighting of your app — sets the mood of every room without changing how anything is laid out. |
| test | `auth.spec.ts` | The Inspector | The home inspector of your app — comes through on a schedule and writes down what's not up to code. |
| test | `e2e/checkout.test.ts` | The Walkthrough | The buyer's walkthrough of your app — opens every door and tries every faucet before move-in. |
| doc | `README.md` | The Welcome Letter | The welcome letter of your app — the page left on the counter for the first guest who arrives. |
| doc | `ARCHITECTURE.md` | The Floor Plan | The floor plan of your app — the diagram every contractor consults to know which room is which. |

### World: a theater production

| Category | File | Concept Name | Metaphor |
|---|---|---|---|
| entry | `src/main.tsx` | The House Lights | The house lights of your app — what comes up first to signal the show is open for business. |
| entry | `app/page.tsx` | The Lobby | The lobby of your app — the first room your audience steps into before any route branches off. |
| logic | `middleware/auth.ts` | The Usher | The usher of your app — checks every ticket before letting a request reach a protected seat. |
| logic | `services/payments.ts` | The Box Office | The box office of your app — where every paid transaction is recorded and reconciled. |
| data | `db/schema.sql` | The Archive Room | The archive room of your app — defines how every program from every show is filed and retrieved. |
| data | `models/user.ts` | The Patron Card | The patron card of your app — the standing record of who each ticket-holder is and what they're owed. |
| ui | `components/Header.tsx` | The Marquee | The marquee of your app — the lit-up bar across the top that tells everyone what's playing tonight. |
| ui | `components/Card.tsx` | The Playbill | The playbill of your app — the standard format the theater uses to present any one production. |
| config | `tsconfig.json` | The House Rules | The house rules of your app — the building codes every script is compiled against. |
| config | `vite.config.ts` | The Stage Manager | The stage manager of your app — coordinates which scripts and assets the build pulls onto the stage. |
| style | `tailwind.config.js` | The Costume Closet | The costume closet of your app — every outfit any component is allowed to wear, listed once for everyone. |
| style | `theme.css` | Stage Lighting | The stage lighting of your app — sets the mood of every scene without changing the blocking underneath. |
| test | `auth.spec.ts` | The Dress Rehearsal | The dress rehearsal of your app — runs the auth flow end-to-end so opening night doesn't surprise anyone. |
| test | `e2e/checkout.test.ts` | Tech Week | Tech week for your app — exercises every system in the checkout flow before real audiences arrive. |
| doc | `README.md` | The Program | The program of your app — what every audience member reads before the show to know what they're in for. |
| doc | `ARCHITECTURE.md` | Director's Notes | The director's notes of your app — the working script that explains why each scene is staged the way it is. |

### World: a working kitchen

| Category | File | Concept Name | Metaphor |
|---|---|---|---|
| entry | `src/main.tsx` | The Service Window | The service window of your app — where every incoming order enters the kitchen and gets routed. |
| logic | `middleware/auth.ts` | The Expediter | The expediter of your app — checks every ticket against the rules before it goes down the line. |
| logic | `services/payments.ts` | The Cashier | The cashier of your app — where the bill is added up and settled at the end of the meal. |
| data | `db/schema.sql` | The Walk-In | The walk-in of your app — defines how every ingredient and saved recipe is shelved and labeled. |
| data | `models/user.ts` | The Regular's Card | The regular's card of your app — what the kitchen remembers about each diner between visits. |
| ui | `components/Header.tsx` | The Chalkboard | The chalkboard of your app — the strip above the pass that announces what's on offer right now. |
| ui | `components/Card.tsx` | The Order Ticket | The order ticket of your app — the standard format every order is written on so the line can read it. |
| config | `tsconfig.json` | The Health Code | The health code of your app — the rules the inspector checks every build against. |
| style | `theme.css` | The Atmosphere | The atmosphere of your app — soft lighting and warm music, the mood the room is set in. |
| test | `auth.spec.ts` | The Tasting | The tasting of your app — the chef tries the auth dish before service begins to make sure it's seasoned right. |
| doc | `README.md` | The Menu | The menu of your app — what every guest reads first to know what the kitchen actually serves. |
| doc | `ARCHITECTURE.md` | The Mise en Place | The mise en place of your app — what was prepped before service so everything else runs in order. |

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
