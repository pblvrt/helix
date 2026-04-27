---
name: x-publish-thread
description: Publish a thread on X/Twitter from a markdown file with per-tweet sections. Loads the first tweet into the composer, clicks "+" for each subsequent tweet, verifies each tweet is within 280 chars. STOPS before "Post all" — the user clicks. Stop on CAPTCHA. No hashtags injected.
---

# X Publish Thread

Publish a thread on X (Twitter) from a draft with `# Tweet N` section headers.

## When to use

- Task type `publish-social` with `payload.platform === 'x'`
- The thread is drafted in `/Users/pablovoorvaart/Code/scout-admin/content/social/<slug>-x.md` with `status: approved`

## Inputs

```json
{
  "postPath": "/Users/pablovoorvaart/Code/scout-admin/content/social/<slug>-x.md",
  "dryRun": false
}
```

## Outputs

```json
{
  "ok": true,
  "tweetCount": 7,
  "screenshot": "data/runs/screenshots/x-<slug>-<ts>.png",
  "awaiting": "user-click-post-all"
}
```

## Contract

**Does:**
1. Chrome check.
2. Parse the MD file: split on `# Tweet N` headers → array of tweet bodies.
3. **Pre-flight validation**: every tweet ≤ 280 chars; no hashtags (`#foo`); no emoji. Abort with a clear error if any tweet fails.
4. Navigate to `https://x.com/compose/post`.
5. Verify login.
6. Paste Tweet 1 into the composer.
7. For each subsequent tweet: click the "+" below-the-last-tweet button → paste the next body.
8. Verify via `take_snapshot` that all tweets appear in the draft stack.
9. `take_screenshot` to `data/runs/screenshots/x-<slug>-<timestamp>.png`.
10. **Stop**. Do not click "Post all".

**Does NOT:**
- Post on own. User clicks.
- Schedule. v1 is immediate + manual.
- Post as a reply to an existing thread (maybe future enhancement).

## Safety

- **CAPTCHA → abort immediately.**
- **Any tweet > 280 chars → abort** with the offending tweet number + length.
- **Hashtags or emoji present → abort** (voice-x.md rule).

## Selectors

X rebuilds its React tree aggressively. Always `take_snapshot` before each click. The "+" (add tweet below) button is labeled "Add post" in English — handle locale by accessible role.
