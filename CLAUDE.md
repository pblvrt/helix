# Helix

Goal-driven agent coordination engine. Electron + React + Express + SQLite.
Goals you set become tasks on a Board; an Executor dispatches each task to
a Claude agent with the right knowledge, MCPs, and skills attached. Per
goal, you scope which MCP servers the spawned `claude` process sees, so
discovery agents don't get LinkedIn tools and outreach agents don't get
GA tools.

The engine is **domain-agnostic**: out of the box it ships with a generic
`executor` agent and the planner/executor commands. To run a real workflow,
write a domain agent + knowledge entries + (optionally) some skills.
[`examples/seo-scout/`](./examples/seo-scout/) is a complete worked example
— the SEO/distribution stack the engine was extracted from.

## The two user-triggered commands

The engine has exactly two slash commands the user invokes manually:

- **`/plan`** — runs the planner agent on a goal. Inspects state (DB, files,
  MCP-derived data) and emits a ranked set of tasks onto the Board. Each
  task carries its own instructions in `description` plus a
  `definitionOfDone`. Never executes anything.
- **`/execute`** — task queue conductor. Walks the backlog in priority
  order; for each task, dispatches a subagent with the task's description
  as the prompt body, the goal's knowledge slice inlined, and only the
  goal's linked MCPs in scope.

That's the whole control flow. New domains plug in by:

1. Dropping a `.claude/agents/<name>.md` describing the worker
2. Optionally seeding `.claude/knowledge/shared/*.md` with reference material
3. Optionally registering skills (Browse tab → install)
4. Creating a goal with `agentType: "<name>"`
5. Hitting `/plan` then `/execute`

No code change required for new workflows.

## Architecture

```
.claude/
  agents/                          generic worker definitions
    chat.md                        per-goal operator chat (one PROPOSE_ACTION per turn)
    executor.md                    domain-agnostic task queue conductor
  commands/
    plan.md                        planner — inspects state, emits tasks
    execute.md                     executor — dispatches backlog tasks
  knowledge/                       (your domain knowledge — empty by default)
  settings.local.json              permissions allowlist

backend/
  core/                            db.ts, types.ts, paths.ts, router.ts, transforms.ts
  modules/
    actions/                       command queue + subprocess manager
    catalog/                       Smithery + skills.sh proxies, MCP OAuth flow
    chat/                          per-goal claude subprocess + tool dispatch
    files/                         in-app artifact viewer (allowlisted FS access)
    goals/                         goal CRUD + goal-runner
    knowledge/                     versioned knowledge entries
    mcp/                           CRUD + .mcp.json sync + OAuth refresher
    schedules/                     cron triggers for /plan, /execute
    skills/                        installed SKILL.md entries
    tasks/                         the Board: status lifecycle + verification
  server.ts                        Express entry — port 3458

electron/
  main.ts                          window, auto-updater, init
  ipc-bridge.ts                    IPC channels → repository/service calls
  mount-http.ts                    mounts framework-agnostic routes onto raw http
  preload.ts                       context bridge

src/                               React frontend
  pages/
    Goals, GoalDetail, Board       primary surfaces
    Executor                       live action stream
    Knowledge, Skills, Mcp         resource managers
  hooks/queries/                   React Query wrappers per module

data/                              runtime state (gitignored)
  app.db                           SQLite — DB-of-record for everything
  runs/<action-id>.jsonl           per-run agent log
  runs/screenshots/                Chrome automation artifacts

examples/seo-scout/                worked example: SEO + content distribution
                                   (agent, skills, knowledge, README explaining
                                    how to wire it in)
```

## Concepts in one paragraph

**Goal** — long-lived intent ("get to 200 newsletter signups"). Has an
agentType, a free-form context markdown block, and a linked set of MCP
servers. **Task** — one Board card. Type is a free-form string; description
is the prompt body the executor inlines. Lifecycle: `backlog → in_progress
→ needs_review → done`, with a `blocked` escape hatch. Verification is a
machine check that flips the task to `done` automatically when it passes.
**Job** — a single `/plan` or `/execute` invocation; one row per run with
its own log file in `data/runs/`. **Action** — what the queue actually
runs: a single Claude subprocess executing one command. Multiple actions
can chain inside a Job (planner emits, executor consumes).

## Filesystem boundaries

The in-app file viewer is allowlisted. Out of the box it can read/write:

- `paths.dataDir` (e.g. `data/`)
- `paths.projectDir` (the repo root — `.claude/`, `scripts/`, the build)
- `/tmp`

Add more roots with `HELIX_EXTRA_FS_ROOTS=/path/one:/path/two`.

## Code conventions

- **Language:** TypeScript throughout
- **Package manager:** npm
- **DB columns:** snake_case
- **API + frontend:** camelCase (transforms in `backend/core/transforms.ts`)
- **Controllers:** framework-agnostic `{ params, query, body } → { status, data }`
- **No raw SQL outside `*.model.ts`**
- **No cross-module internal imports** — pass dependencies via constructor injection

## MCP Servers

The Browse tab at `/#/mcp` pulls the live Smithery registry; install
writes a row to `mcp_connections` and re-materialises `.mcp.json`. Spawned
Claude processes pick it up because they run with `cwd = projectDir`. Per
goal, only linked MCPs are passed via `--mcp-config` so each agent sees
exactly the tools it should.

OAuth-protected MCPs (Smithery's `*.run.tools`) trigger the MCP OAuth 2.1
flow inline on install — browser pops to the issuer, loopback catches the
code, tokens are stored on `config.oauth` in the DB. A 60s refresher
rotates access tokens 5 min before expiry.

**Source of truth is the DB.** `.mcp.json` is a derived projection — don't
hand-edit, changes get overwritten on the next mutation. On a fresh clone,
`importMcpJsonIfEmpty` seeds from `.mcp.json.example` (chrome-devtools
baseline). The runtime `.mcp.json` is gitignored because it can hold
bearer tokens after OAuth installs.

## Quick reference

| Command | What it does |
|---------|-------------|
| `npm run dev:electron` | Electron app (API + dashboard) |
| `npm run start` | Standalone: API on :3458 + dashboard on :5173 |
| `npm run chrome` | Launch Chrome with remote debugging on :9222 |
| `npm run dist` | Build platform installer |
| `npm test` | Vitest |

## First-run setup

```bash
npm install
npm run rebuild            # better-sqlite3 native bindings for Electron
npm run chrome             # optional: Chrome with remote debugging
npm run dev:electron       # window opens; create a Goal and you're off
```

The first-run wizard walks you through an Anthropic API key (for in-app
chat), an MCP server or two from the Smithery catalog, and your first
goal. After that, the engine runs on its own.
