# X (Twitter) Voice Guide

X is for indie hackers, developers, and bootstrappers. Scout's X audience = build-in-public crowd. Tone is sharper, more technical, less polished than LinkedIn.

## Core principles

1. **First tweet is everything.** If it doesn't stop a scroll, the thread dies. Hook with a number, a contrarian take, or a specific before/after.
2. **Short beats long.** A 7-tweet thread with every tweet earning its keep beats a 15-tweet thread with filler.
3. **Show, don't tell.** Screenshots, terminal output, code, metrics. Visual tweets outperform text.
4. **One thread, one idea.** If you find yourself writing "Another thing..." — that's a second thread.
5. **Engage, don't broadcast.** X is a conversation. Reply to comments within the first hour.

## Thread structure

### Tweet 1 — The hook
Must pass the "would I stop scrolling?" test.

Hooks that work:
- Specific number + unexpected outcome: "I built a form builder that hit 32k monthly visitors. I spent $0 on marketing. Here's the full playbook:"
- Before/after: "Before: $500/mo for Apollo. After: $199 once. Same outcome. Here's how:"
- Controversial one-liner: "Most AI SDR tools are a lie. I'm a founder. Here's what I found:"
- Terminal/code screenshot that tells a story on its own

Hooks that die:
- "Let me tell you about..."
- "As a founder..."
- Any question
- "Thread ↓"
- A quote tweet with "Great thread"

### Tweet 2 — The setup
- Who you are (in 1 line)
- Why you're qualified to say this
- Keep it tight — don't re-hook

### Tweets 3-N — The payoff
- One tweet per point
- Each tweet should be tweetable standalone (someone might quote-tweet just that one)
- Numbers, screenshots, specifics
- Line breaks for rhythm — white space matters
- Use "↓" at the end of a tweet to bait continuation (sparingly)

### Final tweet
- The takeaway, restated
- One CTA: follow, link to Scout, reply with your experience
- "If you found this useful, follow me for more builds." works. "Check out Scout!" doesn't.

## Tweet-specific rules

- Max 280 chars per tweet (X's limit)
- Aim for 200-260 chars — leaves room for breathing
- No emojis (almost always)
- No hashtags (they mark you as spam on X)
- Mentions are fine if attributing; avoid "@" tagging large accounts to "get noticed" — cringe

## Patterns for Scout threads

### The "build story" thread
Show the product being made. Screenshots, metrics, pricing, architecture. 7-10 tweets.

### The "teardown" thread
Pick a competitor (Apollo/Clay/Instantly). Show pricing + flaws. Show Scout's approach. End with link.

### The "playbook" thread
Teach one specific thing (submitting to directories, X-ray search, writing an ICP). No product pitch. Product reveal in final tweet or not at all.

### The "ask" thread
"Building [X]. Need honest feedback. What would you change?" 2-3 tweets. Engages the builder crowd.

## Format for publication

`/Users/pablovoorvaart/Code/scout-admin/content/social/<slug>-x.md`

```yaml
---
platform: x
sourcePost: <blog-post-slug>
status: draft                    # draft | approved | published
scheduledFor: YYYY-MM-DD
publishedAt: null
---

# Tweet 1
<200-260 char hook>

# Tweet 2
<setup>

# Tweet 3
<payoff point>

...

# Tweet N
<takeaway + CTA>
```

Separate tweets with `# Tweet N` headers so the `publish-social` command can paste them one-by-one into X's compose UI.

## Quality bar

- [ ] Tweet 1 would stop my scroll
- [ ] No tweet is filler — each earns its keep
- [ ] Every claim has a number or example
- [ ] No hashtags
- [ ] No "here's the thing" or "let me tell you"
- [ ] Thread is under 10 tweets (unless exceptional)
- [ ] Final tweet has one clear CTA
