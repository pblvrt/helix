# Blog Voice Guide

Scout's blog is for founders who are skeptical of SaaS sales tools. Every post must earn the reader's trust by being specific, opinionated, and useful even if they never buy Scout.

## Core principles

1. **Specific beats broad.** "32,000 visitors in 30 days" beats "grew fast." Name the number, the tool, the day.
2. **Show the work.** If you're explaining how to do X, show a real example, real screenshots, real code. No "here's how in 5 easy steps" filler.
3. **Pablo's voice is skeptical and direct.** No hype. No "imagine if..." openings. No AI-generated "In today's fast-paced world."
4. **Opinions > summaries.** Every post should have one thing the author believes that a generic SEO article wouldn't say.
5. **Useful even if they never buy.** A founder who reads the post and doesn't buy should still walk away with something they can use Monday.

## Structure

### Headline
- H1 matches the target keyword verbatim when possible
- Avoid year-stuffing unless genuinely time-relevant ("2026 Guide" is fine for evergreen-but-dated topics)
- Never use "Ultimate Guide" or "Everything You Need to Know"

### Opening (first 3 sentences — the most important block)
- State what the post will give you. No throat-clearing.
- **Bad:** "Lead generation has evolved significantly in recent years..."
- **Good:** "If you're a solo founder doing LinkedIn outbound, there are three tools most people recommend. Two of them will get your account banned. Here's which."

### Body
- 800-2000 words for most posts
- Short paragraphs (1-3 sentences)
- Use lists, tables, and code blocks liberally — readers skim
- One H2 per major section (~300-500 words each)
- Bold the most important sentence in each section
- Include at least one table or comparison if relevant
- If comparing tools, include pricing — readers want the number

### Evidence
- Real numbers when possible (traffic data, pricing, feature counts)
- Screenshots when showing a product or process
- Quotes from other founders with attribution
- If you don't have data, say so: "I don't have numbers for this yet, but in my own experience..."

### Product mentions
- Scout should appear naturally, not as a sidebar ad
- Mention Scout when it genuinely solves the problem the post is about
- Always reference Scout as "Scout" (not "our tool," "my tool," etc.)
- Pricing is fair game: "Scout is $199 once" is more honest than "Scout is affordable"
- Link to scout.pblvrt.com on first mention, plain text after

### Closing
- End with one concrete next step for the reader, not a product pitch
- If the reader isn't ready for Scout, give them a useful takeaway they can act on Monday
- No "Sign up for our newsletter" CTAs

## What to avoid

- Emojis (almost always)
- Em dashes that replace commas (they should mean "and here's the aside")
- "Imagine if..." openings
- "In today's fast-paced..." openings
- Passive voice when active works
- Generic stock-photo phrasing ("leveraging synergies," "game-changer," "next-generation")
- Lists longer than 7 items without subheadings
- AI cliches: "Let's dive in," "The short answer is," "Here's the thing..."

## Format for publication

Every post is a markdown file at `/Users/pablovoorvaart/Code/scout-admin/content/blog/<slug>.md` with frontmatter:

```yaml
---
title: "Exact SEO title — under 60 chars for SERP"
slug: url-slug-matches-filename
date: YYYY-MM-DD
excerpt: "155-char meta description for SERP. Pitch the payoff, not the topic."
author: Scout Team
published: false  # flip to true when ready
targetKeyword: "primary target keyword for this post"
---

# H1 — can differ from title if needed for emphasis

Opening paragraph.

## H2 section...
```

`published: false` means the agent drafted it. Pablo flips to `true` after review.

## Quality bar

Before marking a post `published: true`, check:
- [ ] First 3 sentences tell me what I'll learn, not what the topic is
- [ ] At least one non-obvious opinion
- [ ] At least one specific number, screenshot, or real example
- [ ] No AI cliches
- [ ] Scout is mentioned only where it fits, not shoehorned
- [ ] Target keyword is in the H1, first paragraph, and URL slug
- [ ] Meta excerpt sells the payoff, not the topic
