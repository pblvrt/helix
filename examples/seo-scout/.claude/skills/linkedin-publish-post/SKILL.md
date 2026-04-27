---
name: linkedin-publish-post
description: Publish a LinkedIn feed post (not outreach) on the signed-in user's personal profile. Loads text into the "Start a post" composer via Chrome DevTools MCP, verifies the composer state with a snapshot, and STOPS before the final Post click. The user clicks Post themselves. Stop on CAPTCHA. Respect platform limits (3000 chars max).
---

# LinkedIn Publish Post

Publish a single LinkedIn feed post. Unlike outreach (`linkedin-connections`, `linkedin-messages`) this is broadcast content — posting to your own feed.

## When to use

- Task type `publish-social` with `payload.platform === 'linkedin'`
- The body of the post is already drafted in `/Users/pablovoorvaart/Code/scout-admin/content/social/<slug>-linkedin.md` with `status: approved`

## Inputs

```json
{
  "postPath": "/Users/pablovoorvaart/Code/scout-admin/content/social/<slug>-linkedin.md",
  "dryRun": false
}
```

## Outputs

```json
{
  "ok": true,
  "screenshot": "data/runs/screenshots/linkedin-<slug>-<ts>.png",
  "awaiting": "user-click-post",
  "composerState": "loaded"
}
```

## Contract (what the skill does vs. doesn't)

**Does:**
1. Chrome check — `curl -s http://localhost:9222/json/version` aborts if no Chrome.
2. Navigate to `https://www.linkedin.com/feed/`.
3. Verify login via `take_snapshot` (finds the user avatar / name).
4. Click "Start a post" at the top of the feed.
5. Wait for the compose modal.
6. Paste body (everything after the frontmatter) into the editor.
7. `take_snapshot` to verify the composer contains the text.
8. `take_screenshot` to `data/runs/screenshots/linkedin-<slug>-<timestamp>.png`.
9. **Stop here**. Print the screenshot path and the text "Awaiting human click". Do not click Post.

**Does NOT:**
- Click Post (Pablo's call — one of the non-negotiable safety rails).
- Tag people or add hashtags beyond what's in the draft.
- Pre-schedule via the LinkedIn scheduler (could be added later; v1 is immediate + manual).

## Safety

- **CAPTCHA → abort immediately**, close tab, log it.
- **Text length > 3000 chars → abort** with the byte count, don't truncate.
- Don't navigate away from the composer after loading — keep the tab active so the user can click Post.

## DOM discipline (shared with linkedin-connections)

Always act through `mcp__chrome-devtools__click` with a `uid` from a **fresh snapshot**. LinkedIn's composer is React-rendered and selectors are unstable across locales. Never use `evaluate_script` to dispatch click events — LinkedIn's anti-automation gates these and the post will silently not appear in the feed.

## Locale handling

The composer's "Start a post" button label varies by locale (EN: "Start a post", DE: "Beitrag beginnen", etc.). Use `take_snapshot` to find the button by its role/accessible name rather than hardcoded text. If locale detection fails, prompt the user to run LinkedIn in English temporarily.
