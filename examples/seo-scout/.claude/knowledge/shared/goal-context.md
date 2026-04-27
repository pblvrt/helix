# Reading `goalContext` (applies to every task command)

Every task created by the planner carries a `goalContext` object inside its `payload`. The executor passes the full task context to your `$ARGUMENTS` as:

```
===TASK_CONTEXT===
taskId: 42
type: write-post
priority: 2
payload: { "slug": "apollo-alternative", "goalContext": { ... }, ... }
reason: ...
===END===
```

## What you MUST do at the start of every task run

1. **Parse `payload` as JSON.**
2. **Read `payload.goalContext`** — this is the source of truth for goal-level intent and must shape every decision you make.
3. **Honor `goalContext.context`** (the free-form markdown the user wrote when creating the goal). If it says "focus on comparison posts", bias your work accordingly. If it says "no Reddit", skip any Reddit-related subtasks even if they seem useful. The user's context overrides the voice guides in case of conflict.

## Fields in `goalContext`

| Field | Use it for |
|---|---|
| `goalId` | Tag any output files (frontmatter) with this so we can trace provenance later. |
| `goalTitle` | Useful header in logs; also when naming artifacts. |
| `agentType` | Which agent persona this run is operating as (`seo`, `scout`, etc.). |
| `targetCount` / `currentCount` | If the user specified a target (e.g., "write 10 posts this quarter"), respect it — don't over-produce. |
| `mcpConnections` | Which MCPs were explicitly enabled for this goal. Prefer these over environment defaults. |
| `context` | **The user's actual intent in free-form markdown.** Read closely. |
| `createdAt` | Lets you compare "how long ago" when deciding if a goal's intent is still fresh. |

## If goalContext is missing

A task may have been created manually (`source: manual`) or from an ad-hoc planner run without a goal. In that case `goalContext` will be absent or minimal. Fall back to:
- Default voice guides in `.claude/knowledge/shared/voice-*.md`
- `scout-profile.md` for Scout-specific facts

## Frontmatter tagging

When writing blog/social/reddit drafts, include the goal in the frontmatter:

```yaml
---
goalId: "7"
goalTitle: "Q2 SEO push — focus on comparison posts"
# ... other fields
---
```

This lets the Board UI filter tasks + outputs by goal.
