---
name: reddit-publish
description: Publish a post to a specific subreddit via Chrome — fills title, body, and flair, verifies cadence (max 1 post per sub per week), checks self-promo rules against .claude/knowledge/shared/subreddit-list.json, and STOPS before clicking Post. Stop on CAPTCHA, low-karma requirements, or cadence violations.
---

# Reddit Publish

Post to a subreddit. Unlike LinkedIn/X, Reddit has heterogeneous per-sub rules (self-promo caps, karma gates, flair requirements), so this skill does a lot of pre-flight validation.

## When to use

- Task type `publish-reddit` with `payload.slug` + `payload.subreddit`
- Draft at `/Users/pablovoorvaart/Code/scout-admin/content/social/reddit-<slug>-<sub>.md` with `status: approved`

## Inputs

```json
{
  "postPath": "/Users/pablovoorvaart/Code/scout-admin/content/social/reddit-<slug>-<sub>.md",
  "subreddit": "r/SaaS",
  "dryRun": false
}
```

## Outputs

```json
{
  "ok": true,
  "subreddit": "r/SaaS",
  "title": "<title>",
  "flair": "Build Story",
  "screenshot": "data/runs/screenshots/reddit-<slug>-<sub>-<ts>.png",
  "awaiting": "user-click-post"
}
```

## Contract

**Does:**
1. Load `.claude/knowledge/shared/subreddit-list.json`. Find the target sub entry.
2. **Cadence check**: search `scout-admin/content/social/reddit-*-<sub>.md` for any `publishedAt` within the last 7 days. If any, abort ("Cadence violation: posted to <sub> on <date>").
3. **Self-promo check**: if sub's `selfPromo: strict` and post body contains `scout.pblvrt.com`, abort with guidance to move link to first comment.
4. **Karma check** (best effort): navigate to `https://www.reddit.com/user/me` and read displayed karma. If karma < sub's threshold from subreddit-list.json, abort.
5. Navigate to `https://www.reddit.com/<subreddit>/submit`.
6. Verify login.
7. Select "Post" tab.
8. Fill title + body.
9. If frontmatter `flair` is set: open flair picker, select matching flair. Abort if not found.
10. `take_screenshot` to `data/runs/screenshots/reddit-<slug>-<sub>-<timestamp>.png`.
11. **Stop**. Do not click Post.

**Does NOT:**
- Cross-post automatically to multiple subs.
- Auto-reply to comments after posting (separate skill).
- Post same body across different subs — caller is expected to feed different drafts.

## Safety

- **CAPTCHA → abort immediately.**
- **Never post to `banRisk: high` subs without explicit `--allow-high-risk` flag** (not passed by default).
- **Weekly cadence is a hard rule.** No override flag.

## Auto-response hints

Frontmatter may include `commentResponses: [{trigger, response}]`. Don't auto-post these — just surface them to the user after the post goes live so they can reply themselves.
