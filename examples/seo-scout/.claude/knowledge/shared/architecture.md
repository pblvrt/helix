# Architecture — for agents

This is a reference doc agents read at runtime. Keep it up to date with
anything an agent needs to know about this codebase that isn't obvious from
the code itself.

## How commands run

A command is a markdown file in `.claude/commands/<name>.md`. When the user
submits a command (or a goal runs one), the backend:

1. Reads the frontmatter (optional `agent: <agent-name>`) and the body
   (the prompt).
2. Spawns `claude -p --verbose --dangerously-skip-permissions --output-format stream-json --model claude-opus-4-7 [--agent <name>] <prompt>`.
3. Streams stdout (one JSON object per line) into `data/runs/<action-id>.jsonl`.
4. On exit, marks the action `done` / `error` and wakes the queue.

Only one action runs at a time. Queued actions wait.

## HTTP API (agents can `curl` this)

The backend exposes a REST API at `http://localhost:3458`. Agents that need
to persist state or coordinate with the app should use this:

| Endpoint | Notes |
|---|---|
| `GET /api/goals` | List goals |
| `POST /api/goals` | Create goal |
| `POST /api/goals/:id/start` | Enqueue the configured command for this goal |
| `POST /api/goals/:id/stop` | Cancel the running job |
| `GET /api/actions/history` | Recent actions |
| `GET /api/actions/:id/log` | Full JSON-line log for one action |
| `GET /api/actions/:id/stream` | SSE stream while the action is running |
| `POST /api/actions` | `{ command }` — submit a command directly |
| `GET /api/schedules` | List cron schedules |
| `POST /api/schedules` | Create a cron schedule |
| `GET /api/mcp-connections` | List MCP servers registered in the UI |
| `GET /api/config` | List editable markdown config files |
| `GET /api/user-config` | Generic JSON app config |

The same endpoints are available via Electron IPC (`window.electronAPI.invoke`)
when running inside the desktop shell.

## Where to put things

- New feature with persistent state → `backend/modules/<feature>/` with a
  `<feature>.model.ts` (DB access) and `<feature>.controller.ts` (routes).
- Shared types used by frontend + backend → `backend/core/types.ts`.
- New editable markdown files → register in `backend/modules/config/config.model.ts`.
- New DB tables → `backend/core/db.ts`.
