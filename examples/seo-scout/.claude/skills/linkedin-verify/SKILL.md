---
name: linkedin-verify
description: Reconcile the CRM against actual LinkedIn state. Walks every active lead and audits whether the DB matches reality — finds silent drops (lead marked sent but never delivered), accepted invites we missed, replies we missed, over-sents (the bug class where a lead got messaged 2-3× because previous sends silent-succeeded), and duplicate lead rows for the same person. Auto-fixes only safely-fixable discrepancies (replies, accepts, silent drops with no actual delivery); surfaces oversents and ambiguous cases for human review. Should be run before any outreach cycle and after any production incident. Replaces the old verify-connections and verify-messages backend actions.
---

# LinkedIn Verify

Periodic reconciliation pass. The CRM drifts from LinkedIn reality whenever:
- A previous send silent-dropped (we marked it sent, recipient never got it)
- A previous send silent-succeeded (we marked it failed, but it actually went through → next run double-sent)
- A connection was accepted but our `connections` phase missed it
- A reply landed and our `replies` sweep missed it
- The same person ended up in two CRM rows (Sales Nav row + `/in/` row)

This skill walks the CRM and re-checks each active lead against actual LinkedIn state. Auto-applies safe fixes; flags ambiguous cases.

## Shared knowledge (read first)

- API + DOM snippets: [voyager-endpoints.md](../../knowledge/scout/linkedin/voyager-endpoints.md)
- Locale variants: [locale-variants.md](../../knowledge/scout/linkedin/locale-variants.md)
- Per-user overlay format: [overlay-format.md](../../knowledge/scout/linkedin/overlay-format.md)

---

## Action: verify-connections

**Inputs:** none (operates on full CRM).

**Process:**

1. Pull from CRM:
   - All `connection-sent` leads (primary target — these may have silent-dropped or been accepted)
   - All `approved` and `dead` leads (false-negative recovery — they may actually be pending/connected)
   ```bash
   curl http://localhost:3456/api/leads
   ```

2. For each lead, **resolve the canonical `/in/` publicId**. Sales Nav `ACw...` IDs need conversion via the resolver in voyager-endpoints. Cache resolutions to avoid repeat API calls.

3. For each lead, classify by checking actual state:

   **Method A (preferred — fast, paginated):** Fetch sent-pending invitations + recent connections lists, build sets, intersect. Use the snippets in voyager-endpoints. **Important:** this method's pagination must report whether it cleanly reached the end. If it bailed early (UI button missing, scroll blocked), treat the result as incomplete and fall through to Method B for the leads not found in either set.

   **Method B (per-lead — slow but reliable):** For each lead not found in Method A, navigate to the profile and click the primary card's More button. The dropdown is the source of truth (Creator Mode profiles hide Pending in the overflow menu): Withdraw variant = pending, Message-only = connected, Connect variant = not pending (silent drop or dead).

4. Apply the classification:

   | Currently | Found on LinkedIn as | Action |
   |---|---|---|
   | `connection-sent` | pending invitation | confirmed, no change |
   | `connection-sent` | in recent connections | move to `connected`, set `dateAccepted=today` |
   | `connection-sent` | not in either list, no Pending on profile | **silent drop** — revert to `approved`, clear `dateConnectionSent` |
   | `approved` | pending invitation | recover — set `connection-sent`, set `dateConnectionSent=today` |
   | `approved` | in recent connections | recover — set `connected`, set `dateAccepted=today` |
   | `dead` | pending invitation | recover — set `connection-sent` (but log: was previously dead, why?) |
   | `dead` | in recent connections | recover — set `connected` (same — log) |
   | any | resolved publicId differs from stored | persist the new publicId regardless of stage |

5. **Safety guard:** if Method A pagination did NOT reach the end (we couldn't paginate the full list) AND the count returned is less than half of the expected count, **abort the revert step** for `connection-sent` leads. We can still apply other recoveries safely (recovering approved → pending is safe even with incomplete data; only the destructive revert needs full data).

---

## Action: verify-messages

**Inputs:** none (operates on full CRM).

**Process:**

1. Pull all `messaged` + `reminded` leads.

2. For each lead, invoke the **inspect thread** action from `linkedin-messages` (per-lead navigation to compose URL — DON'T use the global conversations list, it's capped at 20).

3. Classify based on actual thread state vs DB expected state:

   **Expected message count:**
   - `messaged` (no R1, no R2) → expected ourCount = 1
   - `reminded` with `dateReminder1` only → expected ourCount = 2
   - `reminded` with `dateReminder1` AND `dateReminder2` → expected ourCount = 3

   | Thread state | Expected | Action |
   |---|---|---|
   | `lastIsOurs=false`, `theirCount>0`, lead not yet `replied` | n/a | **reply detected** — update to `replied`, `dateReply=today`, append notification |
   | `ourCount === expected`, `lastIsOurs=true`, no negative pattern in any of their messages | match | confirmed, no change |
   | `ourCount < expected` | silent drop of last send | **revert** the most recent send date (e.g. clear `dateReminder1` and revert `stage='messaged'` if R1 silent-dropped). Safe because the new `linkedin-messages` skill has pre-send dedup — re-attempting is safe. |
   | `ourCount > expected` AND `lastIsOurs=true` | over-sent in a previous run (the original bug class) | **do NOT modify** — recipient already got the message(s); reverting would cause re-send. Append notification flagging the lead for human review (consider apology / human takeover). |
   | thread doesn't exist at all | M1 was silent-dropped, recipient never got anything | revert to `connected`, clear `dateFirstMessage`, `firstMessage` |
   | `ourCount` matches but their message contains negative pattern (`not interested`, `please stop`, locale equivalents) | n/a | **mark dead**, append notification (negative reply) |

4. **Persist any newly-resolved publicIds** discovered during navigation.

---

## Action: deduplicate leads

**Inputs:** none.

**Process:**

1. Pull all leads.
2. Group by canonical identifier in priority order: `fsdProfileUrn` > resolved `publicId` > normalized `linkedinUrl`.
3. For each group with >1 row:
   - **Auto-merge if safe:** if one row has stage in `discovered`/`approved` and another has a more advanced stage (`connection-sent`/`connected`/`messaged`), keep the advanced row, mark the discovered/approved row as `merged_into:{otherId}` (or delete after archiving).
   - **Surface for review otherwise:** different advanced stages, conflicting data, etc. — append a `duplicate_lead` notification.

This catches the Tolga case (same person, Sales Nav row + `/in/` row, ended up duplicated).

---

## Output

Single summary object after a full pass:

```json
{
  "ok": true,
  "ranActions": ["verify-connections", "verify-messages", "deduplicate"],
  "connections": {
    "checked": 612,
    "confirmed": 542,
    "movedToConnected": 31,
    "revertedSilentDrop": 18,
    "recoveredFromApproved": 11,
    "recoveredFromDead": 0,
    "publicIdsResolved": 67,
    "salesNavResolved": 12
  },
  "messages": {
    "checked": 87,
    "confirmed": 71,
    "repliesDetected": 4,
    "negativeReplies": 1,
    "silentDropsReverted": 6,
    "oversentFlagged": 5,
    "publicIdsResolved": 8
  },
  "duplicates": {
    "groupsFound": 3,
    "autoMerged": 2,
    "needsReview": 1
  },
  "notifications": [
    { "type": "oversent", "leadId": "21", "name": "Anna Drobakha", "ourCount": 3, "expected": 1 },
    { "type": "duplicate_lead", "groupKey": "tolga-gemicioglu-product-engagement-insights", "leadIds": ["106", "166"] },
    { "type": "weekly_limit_observed", "phase": "connections" }
  ]
}
```

## Hard stops

- CAPTCHA at any point → halt all reconciliation, write notification, return partial summary
- More than 50% of `connection-sent` leads classify as silent-drop in a single pass AND pagination didn't reach end → abort the revert step (likely a pagination bug, not a real silent-drop wave)
- LinkedIn session invalid → halt, surface to user

## When to invoke

- **Before each outreach cycle** — ensures the engine acts on accurate state
- **After any incident** (UI variant change, suspected silent-drop wave, oversent reports from users)
- **Weekly scheduled run** — even when no incident, drift accumulates

The orchestrator (outreach command) should call this skill at the start of every run.
