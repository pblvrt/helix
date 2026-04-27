# Helix

> A goal-driven coordination engine for Claude agents. You write a goal;
> Helix plans tasks, runs them through agents you define, scopes the right
> tools per goal, and verifies outcomes. Electron desktop app, MIT licensed,
> no paid APIs required.

![status](https://img.shields.io/badge/status-alpha-orange)
![license](https://img.shields.io/badge/license-MIT-blue)
![platform](https://img.shields.io/badge/platform-mac%20%7C%20win%20%7C%20linux-lightgrey)

---

## What it is

Helix turns long-lived **goals** into a kanban **board** of **tasks**, each
of which is a Claude subprocess invocation with the right context inlined.
The engine handles the queueing, MCP scoping, knowledge attachment,
verification, and chaining. You write the agents and the goals.

```
                ┌─────────────────────┐
                │      Goal           │  long-lived intent
                │  (agentType, ctx,   │  + per-goal MCP scope
                │   linked MCPs)      │
                └──────────┬──────────┘
                           │
                       /plan   ← user-triggered planner agent
                           │
                           ▼
                ┌─────────────────────┐
                │       Board         │
                │  Backlog → InProg → │  ◄── you can edit, approve, decline
                │  NeedsReview → Done │
                └──────────┬──────────┘
                           │
                       /execute   ← user-triggered executor agent
                           │
                           ▼
                ┌─────────────────────┐
                │    Subprocess       │  claude -p with goal's MCPs only
                │  + verification     │
                └─────────────────────┘
```

Three things make it useful:

1. **Per-goal MCP scoping.** A discovery goal sees only discovery MCPs; an
   outreach goal sees only outreach MCPs. The engine writes a scoped
   `.mcp.json` per spawn and passes it via `--mcp-config`.
2. **MCP catalog + OAuth installer.** Browse the live Smithery registry
   from inside the app; install with one click. Remote MCPs that 401
   trigger the full MCP OAuth 2.1 flow — browser opens, you sign in, a
   bearer header lands in the DB. A background refresher rotates tokens
   before they expire.
3. **Verification + chaining.** Tasks declare `definitionOfDone` and an
   optional `verification` (file_exists, file_contains, url_ok, shell).
   Chained tasks (`onDone`) spawn automatically when the parent verifies.

## Quickstart

```bash
git clone https://github.com/pblvrt/helix.git
cd helix
npm install
npm run rebuild           # better-sqlite3 native bindings for Electron
npm run dev:electron
```

The app opens. The first-run wizard walks you through:

- Setting your Anthropic API key (used by in-app chat; Claude subprocess
  calls use the `claude` CLI from your Claude Max sub, no API tokens billed)
- Optionally browsing the Smithery MCP catalog
- Creating your first goal

## Example: SEO content engine

The repo includes a complete example domain in
[`examples/seo-scout/`](./examples/seo-scout/) — the SEO + content
distribution stack that Helix was originally extracted from. Agent +
skills + knowledge + a README explaining how to wire it in. Use it as a
template for your own domain.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the full walk-through. Short version:

- **Backend:** Express + SQLite, framework-agnostic controllers,
  `mcp_connections` is the source of truth for `.mcp.json`.
- **Electron:** raw HTTP server for agent CLI access (`curl
  http://localhost:3458/api/...`) plus IPC for the renderer.
- **Frontend:** React + React Query + Tailwind. Goals → Board → Executor
  → Knowledge → Skills → MCP.
- **Domain extension:** `.claude/agents/<name>.md` + knowledge entries +
  skills. No code change.

## License

MIT — see [LICENSE](./LICENSE). Copyright © 2026 Pablo Voorvaart.

## Status

Alpha. The engine boots, the OAuth flow works end-to-end, the per-goal
scoping holds, the chat agent drives a real claude subprocess. Expect
rough edges in the wizard, the activity log UI, and onboarding for new
domains. Issues + PRs welcome.
