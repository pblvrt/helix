# Example — SEO/Scout

The opinionated SEO content engine that Helix was originally extracted from.
Demonstrates how to plug a domain-specific agent + knowledge base + skill
library into the core engine.

What's in here:

- **`.claude/agents/seo.md`** — domain agent. Drafts blog posts, LinkedIn,
  X, Reddit; respects voice guides; stops before final Post on every
  destructive action.
- **`.claude/skills/`** — reusable skills the agent invokes:
  - GA4 + Search Console scrape (Chrome automation, no API)
  - LinkedIn / X / Reddit publish (loads composer, stops before Post)
  - Directory submission forms
- **`.claude/knowledge/shared/`** — voice guides (blog, LinkedIn, X, Reddit),
  the canonical Scout product profile, seeded directory + subreddit lists.

## How to use

1. Symlink (or copy) the agent + skills into your top-level `.claude/`:
   ```bash
   ln -s ../examples/seo-scout/.claude/agents/seo.md .claude/agents/seo.md
   for s in examples/seo-scout/.claude/skills/*; do
     ln -s "../../$s" ".claude/skills/$(basename $s)"
   done
   ```
2. Seed the knowledge collection so the agent can read voice guides at
   runtime: copy `examples/seo-scout/.claude/knowledge/shared/*` into your
   `.claude/knowledge/shared/`. The knowledge module imports these on first
   boot.
3. Replace the Scout-specific values:
   - `scout-profile.md` — rewrite for your product
   - `directory-list.json` / `subreddit-list.json` — your targets
   - Hardcoded paths like `/Users/.../scout-admin/content/blog/` — point at
     your own content repo
4. Create a goal with `agentType: "seo"` and the planner emits SEO tasks.

## Caveats

This example treats Scout as the product. Most files mention scout.pblvrt.com
and Pablo's email by way of being honest about provenance. Strip the
specifics; keep the structure.
