---
name: linkedin-messages
description: Manage LinkedIn direct messages — send first message (M1) after a connection accepts, send reminder 1 (R1) at +7 days and reminder 2 (R2) at +14 days, inspect threads, and detect replies. Adapts to UI variants and locale, scopes every DOM operation to the active compose container (multiple chat overlays can persist on the page), and verifies every send by re-reading the thread DOM (LinkedIn provides no API signal that a message actually went through). Pre-send dedup prevents the double-message bug class. Stops on CAPTCHA. Marks `replied` leads as HUMAN_TAKEOVER.
---

# LinkedIn Messages

Owns every messaging action: send M1/R1/R2, inspect threads, detect replies. The send path uses the compose URL (LinkedIn's REST messaging endpoint returns 403 from `evaluate_script`), and verification is **always** by re-reading the thread DOM since the click provides no success signal.

## Shared knowledge (read first)

- API + DOM snippets (compose URL, thread inspection, normalized text matching): [voyager-endpoints.md](../../knowledge/scout/linkedin/voyager-endpoints.md) (Messaging Endpoints section)
- Locale variants (Send, Send Without Note, Pending, Reply prompts): [locale-variants.md](../../knowledge/scout/linkedin/locale-variants.md)
- Per-user overlay format: [overlay-format.md](../../knowledge/scout/linkedin/overlay-format.md)

## User overlay

Same as `linkedin-connections` — use `python3 tools/scout_overlay.py read <userId>` at start, and `python3 tools/scout_overlay.py append <userId> <intent> <text> [scope]` to persist discovered selectors. The resolver (`tools/scout-paths.sh overlay <userId>`) handles locating the file inside Scout's data dir.

## Critical rules (apply to every action below)

1. **Always scope DOM queries to the active compose container** — `.msg-convo-wrapper` first, then `.msg-overlay-conversation-bubble--is-active`, then `section.scaffold-layout__detail`, never `document.querySelector` globally. Multiple message overlays persist across navigations and pollute selectors.

2. **Always pre-send dedup** — read the thread DOM BEFORE clicking send. If the last message is ours AND signature-matches the intended message, do NOT send again. Mark CRM as already-sent. This prevents the double-send class of bug that comes from previous false-negative success detection.

3. **Always post-send verify** — read the thread DOM AGAIN after clicking. The new message must appear as the last item AND be ours AND signature-match. Only then is it "sent". Retry with a longer wait (one re-check at +2.5s) before declaring `unconfirmed_send`.

4. **Use safe text assignment** — `textContent` on a new `<p>`, NOT `innerHTML` interpolation. LLM-generated personalization can contain `<`, `>`, `&` and break HTML if interpolated.

---

## Action: send Message 1 (M1)

**Inputs:** `leadId`, `profileId` (publicId or fsd_profile URN), `message` (the body text — usually a pre-drafted personalized opener from discovery, falling back to `userConfig.message1Template` rendered with the lead's data).

**Process:**

1. **Resolve recipient** — extract `publicId` from `/in/` URL, or use the URN. Sales Nav `ACw...` IDs need resolution first (see voyager-endpoints).

2. **Navigate to compose URL** — `linkedin.com/messaging/compose/?recipient={publicId}` (or URN-based form). Wait for the compose box to render via DOM-ready, not fixed `setTimeout`.

3. **Pre-send DOM read** — inspect the thread (snippet in voyager-endpoints "Inspect thread"). Capture `{ count, lastIsOurs, lastText }`.

4. **Decide based on existing thread state:**
   - Empty thread (count = 0) → proceed to send
   - Last message is theirs (`lastIsOurs === false`) → **they replied** before we sent. Mark CRM as `replied`, HUMAN_TAKEOVER. Do NOT send the templated M1 into an active conversation.
   - Last message is ours AND signature-matches intended → **already sent** (silent-success previous run). Mark CRM as `messaged` without resending.
   - Active conversation (count >= 2) → HUMAN_TAKEOVER, do NOT inject template.
   - Recent activity (last activity < 3 days) → skip this run, retry next cycle.
   - Otherwise → safe to send.

5. **Type and send** — use the safe-text-assign pattern + scoped send button finder (locale variants from voyager-endpoints "Send message via compose URL").

6. **Post-send DOM read** — wait 3s, re-inspect thread. Verify:
   - `count` increased
   - new `lastIsOurs` is `true`
   - new `lastText` signature-matches intended
   If not confirmed, wait another 2.5s and retry once. Still not confirmed → `unconfirmed_send` (not a captcha — flag for human review).

7. **Update CRM:**
   - Confirmed sent → `stage='messaged'`, `dateFirstMessage=today`, `firstMessage=msg`
   - Already sent (alreadySent=true) → same, but log "DB synced, not re-sent"
   - Replied detected → `stage='replied'`, `dateReply=today`, notify HUMAN_TAKEOVER
   - Unconfirmed → do NOT update stage, log error, increment `composeFailures` counter

---

## Action: send Reminder 1 (R1) and Reminder 2 (R2)

**Inputs:** `leadId`, `profileId`, `reminderNumber` (1 or 2), `message` (rendered from `userConfig.reminder1Template` or `reminder2Template`).

**Eligibility (caller checks before invoking):**
- R1: lead in stage `messaged`, has `dateFirstMessage`, no `dateReminder1`, `daysAgo(dateFirstMessage) >= 7`
- R2: lead in stage `reminded`, has `dateReminder1`, no `dateReminder2`, `daysAgo(dateReminder1) >= 7`

**Process:** identical to M1 except:
- Pre-send check additionally treats "they replied since M1/R1" as a reply detection (mark `replied`, skip).
- Post-send: update `dateReminder1` (or `dateReminder2`) and `stage='reminded'`.
- After R2 + 7 more days with no response, the verify skill marks the lead `dead` (handled in `linkedin-verify`, not here).

---

## Action: inspect thread

**Inputs:** `profileId` (or URN).

Used by both the messaging skill (for pre-send / post-send verification) and the verify skill (for reply detection sweeps and silent-drop reconciliation).

**Process:**

1. Navigate to `linkedin.com/messaging/compose/?recipient={publicId}` — opens the existing thread inline if one exists, or shows an empty compose if not.
2. Wait DOM-ready for either `.msg-s-event-listitem[data-event-urn]` (existing thread) or `.msg-form__contenteditable` (empty compose).
3. Read scoped to the active container.

**Output:**

```json
{
  "count": 3,
  "ourCount": 2,
  "theirCount": 1,
  "lastIsOurs": false,
  "lastText": "Sounds interesting, can you share more?"
}
```

The caller decides what to do with this — sending skills use it for dedup/reply detection, verify skill uses it for state reconciliation.

---

## Action: detect replies (sweep)

**Inputs:** none — operates on all leads in `messaged` or `reminded` stages.

**Process:**

1. Pull all `messaged` + `reminded` leads from CRM via `curl http://localhost:3456/api/leads`.
2. For each lead, invoke "inspect thread".
3. If `lastIsOurs === false` AND `theirCount > 0` → reply detected. Update CRM to `replied`, set `dateReply=today`, append to notifications.
4. If `lastIsOurs === true` AND `count >= expected` (1 for messaged, 2 for reminded with R1, 3 with R2) → state matches DB, no action.
5. If `count < expected` → silent-dropped previous send (the verify skill handles repair).
6. If `count > expected` AND `lastIsOurs === true` → over-sent in a previous run (the verify skill flags for human review, no auto-action).

**Important:** This sweep is read-only except for the `replied` state transition (which is always safe — it just halts further automated outreach to that lead).

---

## Output

Every action returns a structured result the orchestrator can read:

```json
{
  "ok": true,
  "action": "send-m1" | "send-r1" | "send-r2" | "inspect" | "detect-replies",
  "alreadySent": false,
  "confirmed": true,
  "beforeCount": 0,
  "afterCount": 1,
  "discoveredVariant": null
}
```

On failure:

```json
{
  "ok": false,
  "action": "send-m1" | "...",
  "error": "captcha" | "unconfirmed_send" | "no_compose_box" | "negative_reply" | "active_conversation",
  "details": "..."
}
```

## Hard stops (do NOT proceed)

- Any voyager call returns HTML, status 429, or status 999 → **CAPTCHA**, halt all automation.
- 3 consecutive `no_compose_box` errors → likely LinkedIn blocking compose URLs for this account. Halt messages phase only, other phases continue.
- Reply detected with negative-pattern match (e.g. "not interested", "no thanks", "please stop", and locale equivalents) → mark `dead`, do NOT continue messaging.

## Recording discovered patterns

Append new working selectors / locale variants to the user's overlay via `python3 tools/scout_overlay.py append <userId> SEND|COMPOSE_BOX|EVENT_LISTITEM "<text>" [scope]`. Future runs use the wider variant list from the start. The helper is idempotent — repeat observations of the same text are silently skipped.
