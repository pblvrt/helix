---
name: directory-submit-form
description: Fill a SaaS/startup directory submission form using scout-profile.md as the source of truth. Navigates to the directory URL, introspects the form fields, maps profile fields to inputs, fills them, screenshots, and STOPS before the final Submit. Never clicks Submit — too much per-directory form variation.
---

# Directory Submit Form

Auto-fill a directory submission form. Used with the `submit-directory` task.

## When to use

- Task type `submit-directory` with `payload.directory` (a name from `directory-list.json`)
- User has a debug Chrome session running

## Inputs

```json
{
  "directory": "Fazier",
  "dryRun": false
}
```

Reads:
- `.claude/knowledge/shared/scout-profile.md` — product profile
- `.claude/knowledge/shared/directory-list.json` — the `profile` object with short/50/100/250-word descriptions + URL + founder email + etc.
- `data/directories.json` — current status table

## Outputs

```json
{
  "directory": "Fazier",
  "url": "https://fazier.com/submit",
  "screenshot": "data/runs/screenshots/directory-fazier-<ts>.png",
  "fieldsFilled": 9,
  "fieldsSkipped": [
    { "label": "Team size", "reason": "no matching profile field" }
  ],
  "awaiting": "user-click-submit"
}
```

## Contract

**Does:**
1. Chrome check.
2. Look up the directory in `directory-list.json` by name. Abort if not found.
3. Navigate to the directory's submission URL.
4. `take_snapshot` → introspect all visible form fields (name, tagline, URL, description, pricing, category, logo URL, screenshots, founder email, etc.).
5. Map fields to profile values (see table below).
6. For each mapped field, use `mcp__chrome-devtools__fill` or `type_text` via `uid`.
7. For dropdowns / selects, pick the best semantic match. If none, skip + log.
8. `take_screenshot` to `data/runs/screenshots/directory-<name>-<timestamp>.png`.
9. Update `data/directories.json` entry: `status: "ready-to-submit"`.
10. **Stop**. Print the list of filled + skipped fields and the screenshot path.

**Does NOT:**
- Click Submit — not under any circumstances. Too much form variation to safely auto-submit.
- Upload files — always prefer hosted URL fields (logo URL, screenshot URLs) over file inputs. If a form requires a file upload and no URL option exists, abort with guidance.
- Solve CAPTCHAs.

## Field → profile mapping

| Form field label pattern | Profile value |
|---|---|
| `name`, `product name`, `title`, `startup` | `profile.name` |
| `tagline`, `short description`, `elevator pitch`, `slogan` | `profile.tagline` |
| `url`, `website`, `link` | `profile.url` |
| `description`, `about`, `long description`, `pitch` (long) | `desc250` from scout-profile.md |
| `description` (short, < 100 chars) | `profile.desc50` |
| `category`, `tag` (primary) | `profile.categoryPrimary` |
| `pricing`, `price`, `cost` | `profile.pricing` |
| `platform`, `os`, `supported` | `profile.platform` |
| `founder`, `creator`, `team`, `contact name` | `profile.founderName` |
| `email`, `contact email` | `profile.founderEmail` |
| `logo`, `icon`, `image url` | `https://scout.pblvrt.com/logo.png` |
| `screenshot`, `screenshot url`, `demo image` | `https://scout.pblvrt.com/screenshots/dashboard.png` |

## Safety

- **Never submit.** This is a hard rule.
- **Never upload files.** Always prefer URL-based fields.
- **Stop on CAPTCHA.** Log and exit.
- **One directory per invocation.** Don't chain.
