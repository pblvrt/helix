---
name: linkedin-connections
description: Manage LinkedIn connection requests — send new invites, withdraw stale pending invites, and accept incoming requests. Adapts to the user's specific LinkedIn UI variant and locale, verifies every action against the profile DOM (not just API status codes — LinkedIn returns ambiguous responses), and persists discovered selectors to a per-user overlay so subsequent runs are deterministic. Stops on CAPTCHA. Distinguishes weekly invite limit from CAPTCHA.
---

# LinkedIn Connections

Owns every connection-related action: send, withdraw, accept.

**Every click must go through `mcp__chrome-devtools__click` on a `uid` from a fresh snapshot.** Do NOT use scripted `fetch()` to call invite APIs, and do NOT use `element.click()` inside `evaluate_script`. Both are gated by LinkedIn's anti-automation:

- Scripted `fetch()` is missing per-pageview headers (`x-li-page-instance-tracking-id`, `x-li-page-instance`, `x-li-application-instance`, `x-li-application-version`, `x-li-track`) that are generated inside LinkedIn's minified JS in a closure. The server returns 200 with a post-connect UI template but does NOT create the invitation server-side. This was verified empirically — 11 scripted sends in a row produced 0 actual pending invites.
- Scripted `element.click()` fires events with `isTrusted=false`. LinkedIn's React click handlers check `isTrusted` and skip the invite code path when it's false.
- `mcp__chrome-devtools__click` clicks the actual UI element via the Chrome DevTools MCP — this produces a real user-gesture event with `isTrusted=true` and LinkedIn treats it identically to a human mouse click. **This is the one path that actually creates invitations. Click the UI buttons (More → Invite → Send without a note). Do not try to be clever.**

**Verification source of truth:** the `/mynetwork/invitation-manager/sent/` list. Do NOT trust RSC response bodies or the profile page's primary CTA area — the response template and Creator Mode UI both look identical to "never sent" even on successful sends.

## Shared knowledge (read first)

- Locale variants for buttons / states: [locale-variants.md](../../knowledge/scout/linkedin/locale-variants.md)
- Per-user overlay format: [overlay-format.md](../../knowledge/scout/linkedin/overlay-format.md)
- Read-only voyager APIs (identity resolution, Sales Nav `ACw…` → `/in/`, listing recent connections): [voyager-endpoints.md](../../knowledge/scout/linkedin/voyager-endpoints.md). Note: do NOT use the send endpoints documented there — those ran before the LinkedIn RSC migration and no longer create invitations when called directly.

## User overlay

At the start of every run, read the user's overlay via `python3 tools/scout_overlay.py read <userId>` (resolves to `{data-dir}/ui-overlays/{userId}.md` — see `python3 tools/scout_paths.py`). Empty output means no overlay yet. The overlay tells you which locale-variant uids/labels this specific user's LinkedIn actually uses. When you discover a new working variant (e.g., a different "Send without a note" label), persist it with `python3 tools/scout_overlay.py append <userId> <intent> <text>` — it appends idempotently.

If `userId` is not in user-config, derive it from the authenticated LinkedIn URN suffix.

---

## Action: send connection

**Inputs:** `leadId` (CRM id), `profileId` (`/in/` publicId, Sales Nav `ACw...`, or full URL).

**Process:**

1. **Resolve vanityName (publicId).** If Sales Nav `ACw…`, convert via the Sales-Nav-to-`/in/` resolver in [voyager-endpoints.md](../../knowledge/scout/linkedin/voyager-endpoints.md).

2. **Navigate** to `https://www.linkedin.com/in/{vanityName}/` via `mcp__chrome-devtools__navigate_page`. Wait ~3s for the profile card to render.

3. **Snapshot 1 — find the invite trigger.** Call `mcp__chrome-devtools__take_snapshot` with `filePath: /tmp/snap-<vanityName>-1.txt`. The snapshot will be 100–200KB; you MUST use the `filePath` parameter and grep the file instead of reading the whole thing back into context. Use the `Grep` tool on the saved file:

   - **First**, look for a direct invite button: `grep 'button "Invite {First Last} to connect"'` or `grep 'menuitem "Invite {First Last} to connect"'`. If found → that's the invite uid, skip to step 5.
   - **Otherwise** (Creator Mode / overflow profile), find the primary-card `More` button. Two `button "More" expandable` lines usually exist in the snapshot — pick the one that appears AFTER the `Message` link and `Follow {Name}` button (the primary profile actions cluster). Grep context with `grep -n -B2 -A1 'button "More" expandable'` to pick the right uid.

4. **Open the More dropdown** (Creator Mode branch only). Call `mcp__chrome-devtools__click` with the primary-card More uid. Take snapshot 2 to `/tmp/snap-<vanityName>-2.txt`. Grep for `menuitem "Invite {First Last} to connect"`. If the menuitem is missing even after opening More, the profile is genuinely locked from connections (rare) — mark `stage='dead'` and move on.

5. **Click the invite trigger.** `mcp__chrome-devtools__click` on the uid from step 3 (direct case) or step 4 (More-dropdown case).

6. **Send-without-note modal.** Take snapshot 3 to `/tmp/snap-<vanityName>-3.txt`. Grep for `button "Send without a note"` (or locale variants from [locale-variants.md](../../knowledge/scout/linkedin/locale-variants.md) — "ohne Nachricht senden", "envoyer sans note", etc.). `mcp__chrome-devtools__click` on the button uid.

7. **Post-send delay.** Wait ~2–3s so the server records the invitation before moving on.

8. **Verify at the end of the whole connections phase, not per profile.** After the batch, navigate once to `https://www.linkedin.com/mynetwork/invitation-manager/sent/` and scrape all `/in/{publicId}` hrefs via `evaluate_script`. For each lead you clicked through:

   - Target publicId is in the scraped list → **sent confirmed.** PATCH CRM: `stage='connection-sent'`, `dateConnectionSent=today`.
   - Target publicId is NOT in the list → **silent drop / never sent.** Do NOT update CRM. If 3+ consecutive targets are missing, halt connections phase for this run (weekly limit or anti-abuse).

9. **Record discovered variants.** If a different locale label worked for "Send without a note" or the More/Invite menu items, append to the user's overlay: `python3 tools/scout_overlay.py append <userId> SEND_WITHOUT_NOTE "<exact text>"`.

### Hard stops

- `mcp__chrome-devtools__navigate_page` redirects to `/checkpoint/` / `/uas/login/` → **session invalid or CAPTCHA.** Halt all automation; surface to user.
- Snapshot grep reports the profile page is a sign-in page (e.g., uid with "Sign in" button at top of the a11y tree) → same, halt.
- 3+ consecutive "not in sent list" after clicking through → weekly limit or anti-abuse trigger, halt connections phase only (other phases continue).

---

## Action: withdraw stale pending

**Inputs:** `leadId`, `profileId`. Used when an invite has been pending >60 days and the lead should be marked dead.

**Process:**

1. Navigate to `linkedin.com/in/{profileId}/`
2. The profile shows "Pending" + a withdraw control. Locale variants for the withdraw button: see [locale-variants.md](../../knowledge/scout/linkedin/locale-variants.md).
3. Click the withdraw control, confirm in the modal.
4. **DOM verify** — re-check the profile, "Pending" should be gone, Connect should reappear.
5. **Update CRM** — `stage='dead'`, log the withdrawal date.

---

## Action: accept incoming request

**Inputs:** `profileId` of the inviter.

**Process:**

1. Navigate to `linkedin.com/mynetwork/invitation-manager/` (incoming view).
2. Find the inviter row, click Accept (locale variants apply).
3. **DOM verify** — the row should disappear from the incoming list, the inviter should now show as a 1st-degree connection.
4. **Optional CRM update** — if this person is in the CRM, mark `stage='connected'`. If not, this is an inbound request from someone we didn't proactively prospect — log it as a notification for human review.

---

## Output

Every action returns a structured result the orchestrator can read:

```json
{
  "ok": true,
  "action": "send" | "withdraw" | "accept",
  "via": "method1-api" | "method2-rsc" | "ui-direct" | "ui-via-more" | "ui-adapted",
  "resolvedPublicId": "...",
  "verifiedAt": 1234567890,
  "discoveredVariant": null | { "intent": "CONNECT", "text": "...", "scope": "..." }
}
```

On failure:

```json
{
  "ok": false,
  "action": "send" | "withdraw" | "accept",
  "error": "captcha" | "weekly_limit" | "not_found" | "session_invalid" | "already_connected",
  "details": "..."
}
```

## Hard stops (do NOT proceed)

- Any voyager call returns HTML, status 429, or status 999 → **CAPTCHA**, halt all automation. Log clearly in the run output (JSONL).
- Send: API returns ambiguous status + DOM shows no Pending after 5 retries → **weekly limit**, halt connections only. Log it; other phases continue.
- LinkedIn session cookies missing → **session invalid**, surface to user, halt.
