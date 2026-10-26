---
agent: executor
description: "Task queue conductor. Dispatches each backlog task to the agent declared on it, using the task's own description as the prompt body. Domain-agnostic — no per-type command files."
---

# execute — Run the Task Backlog

You run in a single long-lived session. For each backlog task you pop a row,
mark it `in_progress`, build a prompt from the task itself, dispatch the
chosen agent via the `Task` tool, and PATCH the result back.

**There are no per-task-type command files.** The task row *is* the command.
The planner (or whoever creates the task) writes the instructions into
`task.description`. The executor just threads those instructions plus
context into the prompt. Adding a new workflow = creating a task with new
instructions. No file changes, no enum edits.

## Per-task workflow

1. Pick a backlog task: `GET /api/tasks?status=backlog&eligibleOnly=true`
   honoring `onlyType` / `onlyGoalId` / `onlyAgent` filters. The
   `eligibleOnly` flag hides tasks whose `scheduledFor` is in the future
   — those are waiting for their scheduled time and aren't runnable yet.
2. `GET /api/tasks/:id` for the full row.
3. Resolve the agent from `task.payload.goalContext.agentType`. If missing,
   PATCH the task to `blocked` and continue — the planner must declare an
   agent. **Also block** if the declared agent has no
   `.claude/agents/<name>.md` file: without it the `Task` tool spawns a
   stripped-down default subagent (no MCP allowlist, no skills) that will
   silently burn the 1-hour budget pretending to work. The block message
   should tell the user to wire the agent in.
4. `PATCH /api/tasks/:id { status: "in_progress" }`.
5. Build the prompt (see "Prompt shape" below).
6. Spawn via `Task` tool with `subagent_type = <agentType>`.
7. On return, parse the `===TASK_RESULT===` block. Valid agent-reported
   statuses are `needs_review` and `blocked`. **Agents never report `done`**
   — that transition is gated by the server (human Approve or passing
   verification).
8. PATCH `{ status, summary, artifacts }`.
9. If status is `needs_review`, fire one-shot
   `POST /api/tasks/:id/approve` — the server flips to `done` and spawns
   the chain only if verification passes without a human. Ignore the
   response either way.
10. Log one line, loop.

## Prompt shape

The prompt the subagent sees is three concatenated blocks:

```
===KNOWLEDGE===
<markdown, fetched from /api/knowledge/prompt with the slugs the agent declares>
===END===

===TASK_CONTEXT===
taskId:           <id>
type:             <type>
title:            <title>
priority:         <priority>
payload:          <full payload JSON, including goalContext>
reason:           <why the planner created it>
definitionOfDone: <task.definitionOfDone>
verification:     <task.verification>
reviewFeedback:   <task.reviewFeedback — set if this is a retry>
reviewHistory:    <prior declines, if any>
===END===

===INSTRUCTIONS===
<task.description — the actual recipe for this task>
===END===

End your final message with a ===TASK_RESULT=== block:
{
  "status":   "needs_review" | "blocked",
  "summary":  "one-line result",
  "artifacts": [{ "kind": "file|url|screenshot|note", "path|url"?: "...", "label": "..." }]
}
```

### Where do the knowledge slugs come from?

The agent's own `.md` frontmatter declares a default knowledge slice under
`knowledge-slugs`. The task can override by setting
`payload.knowledgeSlugs` — useful when one specific task needs extra
context the agent doesn't usually read.

Resolve: `task.payload.knowledgeSlugs ?? agentFrontmatter.knowledgeSlugs ?? ["goal-context"]`.

Fetch: `GET /api/knowledge/prompt?slugs=<csv>`.

## Curl idioms — fail loudly, never swallow errors

Every API mutation MUST surface failures or you'll silently lose state.
Pattern:

```bash
curl -s --fail-with-body -X PATCH "$URL" \
  -H 'Content-Type: application/json' -d '{...}' \
  || { echo "PATCH $URL FAILED — aborting"; exit 1; }
```

- `-s` quiet progress, `-f` fail on HTTP error, `--fail-with-body` print
  the error body so you know *why*.
- Always `|| { echo ...; exit 1; }`. Never `; echo ...` (always-prints
  obscures the failure). Never `> /dev/null 2>&1 || true` on a mutation —
  that mistakes "succeeded" for "failed silently."

If the API is down mid-run (hot-reload restart, killed window), the right
move is to abort the iteration. The next `/execute` invocation will pick
the task back up — boot recovery moves stranded `in_progress` rows to
`backlog`, but it logs that it did so.

## Shell for the loop

```bash
# Parse filters from $ARGUMENTS
ONLY_TYPE=$(printf '%s\n'  "$ARGUMENTS" | grep -oE 'onlyType=[^ ]+'    | cut -d= -f2-)
ONLY_GOAL=$(printf '%s\n'  "$ARGUMENTS" | grep -oE 'onlyGoalId=[^ ]+'  | cut -d= -f2-)
ONLY_AGENT=$(printf '%s\n' "$ARGUMENTS" | grep -oE 'onlyAgent=[^ ]+'   | cut -d= -f2-)

TASKS_JSON=$(curl -sf 'http://localhost:3458/api/tasks?status=backlog&eligibleOnly=true') \
  || { echo "GET /api/tasks FAILED"; exit 1; }
TASK_ID=$(echo "$TASKS_JSON" | jq -r \
  --arg t "$ONLY_TYPE" --arg g "$ONLY_GOAL" --arg a "$ONLY_AGENT" '
    map(select(
      ($t == "" or .type == $t) and
      ($g == "" or (.payload.goalContext.goalId // "" | tostring) == $g) and
      ($a == "" or (.payload.goalContext.agentType // "") == $a)
    )) | .[0].id // empty')

TASK=$(curl -sf "http://localhost:3458/api/tasks/$TASK_ID") \
  || { echo "GET /api/tasks/$TASK_ID FAILED"; exit 1; }
AGENT=$(echo "$TASK" | jq -r '.payload.goalContext.agentType // empty')
if [ -z "$AGENT" ]; then
  curl -s --fail-with-body -X PATCH "http://localhost:3458/api/tasks/$TASK_ID" \
    -H 'Content-Type: application/json' \
    -d '{"status":"blocked","summary":"no agentType on task — planner must set payload.goalContext.agentType"}' \
    || { echo "PATCH blocked FAILED for #$TASK_ID"; exit 1; }
  continue
fi

# Fail FAST if the declared agent has no .md file in this project. Without
# the file, the Task tool spawns a default subagent with a stripped-down
# tool set (no MCP allowlist, no skills) — which silently burns the 1-hour
# budget pretending to work. Mark blocked and tell the user to wire it up.
AGENT_FILE=".claude/agents/$AGENT.md"
if [ ! -f "$AGENT_FILE" ]; then
  curl -s --fail-with-body -X PATCH "http://localhost:3458/api/tasks/$TASK_ID" \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg a "$AGENT" \
      '{status:"blocked",summary:("agentType `"+$a+"` has no agent file at .claude/agents/"+$a+".md — wire it in (e.g. via examples/seo-scout/README.md), or change the goal'\''s agentType.")}')" \
    || { echo "PATCH blocked FAILED for #$TASK_ID"; exit 1; }
  continue
fi

curl -s --fail-with-body -X PATCH "http://localhost:3458/api/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' -d '{"status":"in_progress"}' \
  || { echo "PATCH in_progress FAILED for #$TASK_ID"; exit 1; }

# Knowledge slugs: task override → agent default → ["goal-context"]
SLUGS=$(echo "$TASK" | jq -r '.payload.knowledgeSlugs | if type=="array" then join(",") else "" end')
if [ -z "$SLUGS" ]; then
  # Read the agent's frontmatter for default knowledge-slugs.
  AGENT_FILE=".claude/agents/$AGENT.md"
  SLUGS=$(awk '/^---$/{n++; next} n==1' "$AGENT_FILE" \
    | grep -E '^knowledge-slugs:' \
    | sed -E 's/^knowledge-slugs:[[:space:]]*\[?([^]]*)\]?.*/\1/' | tr -d ' ')
fi
SLUGS=${SLUGS:-goal-context}
KNOWLEDGE=$(curl -sf "http://localhost:3458/api/knowledge/prompt?slugs=$SLUGS" | jq -r '.markdown') \
  || { echo "GET /api/knowledge/prompt FAILED"; exit 1; }
```

Then invoke the `Task` tool with the shape documented above and the fields
pulled from `$TASK`.

### PATCHing the result

```bash
STATUS=$(echo "$RESULT_JSON" | jq -r '.status // "needs_review"')
case "$STATUS" in needs_review|blocked) ;; *) STATUS="needs_review" ;; esac
SUMMARY=$(echo "$RESULT_JSON" | jq -r '.summary // ""')
ARTIFACTS=$(echo "$RESULT_JSON" | jq -c '.artifacts // []')

curl -s --fail-with-body -X PATCH "http://localhost:3458/api/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg s "$STATUS" --arg sum "$SUMMARY" --argjson a "$ARTIFACTS" \
        '{status: $s, summary: $sum, artifacts: $a}')" \
  || { echo "PATCH result FAILED for #$TASK_ID — work was done but not recorded"; exit 1; }

# Auto-verify promotes the card if it has a machine check. We DON'T treat a
# 422 here as fatal — it just means verification didn't pass and the card
# stays in needs_review for human review (which is the correct fallback).
if [ "$STATUS" = "needs_review" ]; then
  curl -s --fail-with-body -X POST "http://localhost:3458/api/tasks/$TASK_ID/approve" \
    || echo "auto-approve declined for #$TASK_ID — left in needs_review for human review"
fi
```

Print one line per task: `#<id> <type> → <status> (<summary>) (<elapsed>)`.

On CAPTCHA / irrecoverable error: PATCH `status=blocked` with the reason and
stop the whole executor.

## Stop conditions

- Backlog empty → exit 0.
- `maxTasks` consumed → exit with summary.
- CAPTCHA reported → mark `blocked`, stop.
- 3 consecutive failures on the same task → mark `blocked`, continue.

## Rules

- **Task tool only for work dispatch.** Never create sibling actions.
- **One subagent at a time.**
- **Agent can only reach `needs_review` or `blocked`.** `done` is server-owned.
- **Budget: 4 hours.**

$ARGUMENTS
