# Patterns

The template is small on purpose. Five patterns are worth learning before you
change anything; everything else is just applying them consistently.

## 1. Feature modules

Every domain entity lives in `backend/modules/<feature>/` and has two files:

- `<feature>.model.ts` — data access. Owns all SQL for this entity. Exports a
  factory (`createXxxRepository(db)`) that returns an object of methods.
- `<feature>.controller.ts` — route definitions. Framework-agnostic: each
  handler takes `{ params, query, body }` and returns `{ status, data }`.

Cross-module dependencies flow through the factory arg, not through imports.
If goals need actions, the goal-runner takes a `jobManager` as a constructor
arg — it doesn't reach into `backend/modules/actions/`.

**Rule:** no raw SQL outside a `*.model.ts` file. No cross-module imports of
internal helpers.

## 2. Transport adapters call the same controllers

A controller doesn't know what called it. Three adapters translate transport
to controller calls:

- `backend/mount.ts` — Express. Used by `npm run server` (standalone web mode).
- `electron/mount-http.ts` — raw `http.createServer`. Used by the Electron shell
  so agents can `curl` the API at `localhost:3456`.
- `electron/ipc-bridge.ts` — Electron IPC. Used by the renderer for fast,
  auth-less, in-process calls.

When you add a controller, you wire it into all three adapters. The handler
code stays identical.

## 3. snake_case ↔ camelCase

DB columns are snake_case (`date_created`). Everywhere else is camelCase
(`dateCreated`). `backend/core/transforms.ts` owns all conversion:

- A `FOO_FIELDS` record maps camel → snake. Writes iterate this to build a
  SET clause.
- A `fooToCamel(row)` function converts a row to the TypeScript type.

When you add a field to the schema, you update the type, the FOO_FIELDS map,
and the fooToCamel function. No magic auto-conversion.

## 4. Commands are files

`.claude/commands/<name>.md` is the unit of automation. The body is the prompt
the agent receives; frontmatter can specify an `agent` (a file in
`.claude/agents/`). At runtime the job manager does:

```ts
spawn('claude', [
  '-p', '--verbose', '--dangerously-skip-permissions',
  '--output-format', 'stream-json', '--model', 'claude-opus-4-7',
  '--agent', cmd.agent,
  cmd.prompt,
]);
```

stdout is parsed one JSON object per line and appended to
`data/runs/<action-id>.jsonl`. The UI tails that file via SSE (web) or via
`webContents.send` (Electron).

**To add a command:** drop a markdown file. That's it. The `actionsRepo`
reads the directory on each call, so there's no build step.

## 5. Single API client

`src/api/client.ts` is the one place that talks to the backend. It picks the
transport at runtime:

```ts
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

export async function fetchGoals(): Promise<Goal[]> {
  if (isElectron) return ipc('goals:list');
  const res = await fetch(`${API}/goals`);
  if (!res.ok) throw new Error('Failed to fetch goals');
  return res.json();
}
```

Pages never call `fetch` or `ipc` directly. Hooks in `src/hooks/queries/`
wrap the client functions in `@tanstack/react-query`.

---

## Adding a feature end-to-end: `items`

Suppose you want a simple items list. Work through each pattern once:

### 1. Schema (`backend/core/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2. Shared type (`backend/core/types.ts`)

```ts
export interface Item {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
```

### 3. Transform (`backend/core/transforms.ts`)

```ts
export const ITEM_FIELDS: Record<string, string> = {
  title: 'title',
  description: 'description',
};

export function itemToCamel(row: Row): Item {
  return {
    id: String(row.id),
    title: row.title as string,
    description: (row.description as string) || '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
```

### 4. Model (`backend/modules/items/items.model.ts`)

```ts
import type Database from 'better-sqlite3';
import { itemToCamel, ITEM_FIELDS } from '../../core/transforms.js';
import type { Item } from '../../core/types.js';

export function createItemsRepository(db: Database.Database) {
  return {
    list: (): Item[] => db.prepare('SELECT * FROM items ORDER BY id DESC').all().map(r => itemToCamel(r as any)),
    get: (id: string): Item | null => {
      const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      return row ? itemToCamel(row as any) : null;
    },
    create: (data: { title: string; description?: string }): Item => {
      const r = db.prepare('INSERT INTO items (title, description) VALUES (?, ?)').run(data.title, data.description || '');
      return itemToCamel(db.prepare('SELECT * FROM items WHERE id = ?').get(r.lastInsertRowid) as any);
    },
    update: (id: string, data: Partial<Item>): Item | null => {
      const sets: string[] = [], values: unknown[] = [];
      for (const [camel, snake] of Object.entries(ITEM_FIELDS)) {
        if (camel in data) { sets.push(`${snake} = ?`); values.push((data as any)[camel]); }
      }
      if (!sets.length) return null;
      sets.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      return row ? itemToCamel(row as any) : null;
    },
    delete: (id: string) => { db.prepare('DELETE FROM items WHERE id = ?').run(id); return { ok: true as const }; },
  };
}
```

### 5. Controller (`backend/modules/items/items.controller.ts`)

```ts
import type { RouteDefinition } from '../../core/router.js';
import type { createItemsRepository } from './items.model.js';

export function createItemsController(deps: { items: ReturnType<typeof createItemsRepository> }): RouteDefinition[] {
  const { items } = deps;
  return [
    { method: 'get', path: '/api/items', handler: () => ({ status: 200, data: items.list() }) },
    { method: 'get', path: '/api/items/:id', handler: ({ params }) => {
      const item = items.get(params.id);
      return item ? { status: 200, data: item } : { status: 404, data: { error: 'Not found' } };
    }},
    { method: 'post', path: '/api/items', handler: ({ body }) => ({ status: 201, data: items.create(body as any) }) },
    { method: 'patch', path: '/api/items/:id', handler: ({ params, body }) => {
      const item = items.update(params.id, body as any);
      return item ? { status: 200, data: item } : { status: 400, data: { error: 'No valid fields' } };
    }},
    { method: 'delete', path: '/api/items/:id', handler: ({ params }) => ({ status: 200, data: items.delete(params.id) }) },
  ];
}
```

### 6. Wire the adapters

- `backend/server.ts`: `createItemsRepository(db)` + spread `createItemsController` into `mountRoutes`.
- `electron/main.ts`: same repository + controller in the HTTP mount.
- `electron/ipc-bridge.ts`: add `ipcMain.handle('items:list', ...)` (etc.) calling the repo directly.
- `electron/preload.ts`: add `'items:list'` etc. to `validInvokeChannels`.

### 7. API client (`src/api/client.ts`)

```ts
export async function fetchItems(): Promise<Item[]> {
  if (isElectron) return ipc('items:list');
  const res = await fetch(`${API}/items`);
  if (!res.ok) throw new Error('Failed to fetch items');
  return res.json();
}
// …create/update/delete similarly
```

### 8. React query hook (`src/hooks/queries/useItems.ts`)

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchItems } from '../../api/client';

export function useItems() {
  return useQuery({ queryKey: ['items'], queryFn: fetchItems });
}
```

### 9. Page (`src/pages/Items.tsx`)

Render a list, wire up create/update/delete mutations — standard React. Add
the route in `src/App.tsx` and the nav entry in `src/components/Sidebar.tsx`.

---

## Things not to do

- **Don't add SQL outside a model file.** If you're reaching for `db.prepare`
  outside `*.model.ts`, you're about to bypass the convention.
- **Don't import another module's internals.** If two modules need to share a
  repository, pass it in via the constructor.
- **Don't redefine types in the frontend.** `src/api/client.ts` re-exports
  from `backend/core/types.ts`; import from the client.
- **Don't call `fetch` or `window.electronAPI` from a page.** Go through
  `src/api/client.ts`.
- **Don't let a controller depend on Express or IPC.** A handler signature is
  `({ params, query, body }) => { status, data }`. No req/res, no ipcEvent.
