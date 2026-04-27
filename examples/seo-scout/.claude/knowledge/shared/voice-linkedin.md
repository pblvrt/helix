# LinkedIn Voice Guide

LinkedIn is a lead-gen channel for Scout. Every post must either (a) teach something useful about sales/outbound or (b) tell a specific story — never pitch first.

## Core principles

1. **Hook in line 1.** LinkedIn shows ~2 lines before "see more." If line 1 doesn't earn the click, the post is invisible.
2. **Pattern: specific number + counter-intuitive claim.** "I built a tool that ranked #1 on Fazier. It took me zero marketing spend." works. "I built a great tool!" doesn't.
3. **Story, not thought leadership.** Posts that open with "I..." outperform posts that open with "Founders..." 3-5x.
4. **One idea per post.** Don't stack three lessons. Pick one. Readers remember one thing.
5. **No hashtag spam.** 3 hashtags max, at the very end.

## Structure

### Hook (line 1 — one sentence)
- Start with a number, a contrarian claim, or a specific moment
- Bad: "Lead generation is hard."
- Good: "I spent $0 on marketing and hit 32k monthly visitors in 30 days."

### Setup (lines 2-4)
- Who are you / what did you do / what's the stakes
- Set up the story or the claim

### Body (short paragraphs, 1-3 sentences each)
- Line breaks between every idea — LinkedIn eats whitespace, embrace it
- Use → arrows, numbered lists, or em-dashes sparingly
- Specific details > general lessons
- Show the mechanism, not just the outcome

### Close (final 2-3 lines)
- One-line lesson or call to reflection
- If pitching Scout, keep it one line: "I built Scout to do this end-to-end. Link in comments."
- Hashtags at the very end, max 3

## Length

- Best: 1200-1500 characters (expanded-view sweet spot)
- Minimum: 500 characters — shorter posts feel like throwaway thoughts
- Maximum: 3000 characters — longer gets truncated

## Hooks that work (steal shamelessly)

- "I [did specific thing] and [specific unexpected outcome]. Here's the full playbook."
- "[Specific number]. [Specific number]. [Specific number]. Here's what these mean for [audience]."
- "Most [audience] believe [X]. I've done it 30 times. [X] is wrong."
- "A [role] just told me [specific quote]. It reframed how I think about [topic]."
- "Stop doing [common thing]. Start doing [specific alternative]. Here's why."

## Hooks that don't work (banned)

- "In today's fast-paced world..."
- "As a founder, I often think about..."
- "Here's a thought..."
- "Agree or disagree?"
- Any question as the first line
- Any post that opens with an emoji

## Patterns for Scout posts

### The "build in public" post
Lead with a number (users, revenue, ranking). Show the work behind it. End with a lesson. Link to Scout in comments.

### The "teardown" post
Pick a tool (Apollo, Clay, Instantly). Show pricing + one flaw. Share what you built instead. Link to Scout.

### The "lesson from a user" post
Quote a founder who's using Scout or who Pablo talked to. Extract one insight. Generalize.

### The "technical" post
Show a specific automation or script. Explain why it works. Credit Scout as the tool that runs it end-to-end.

## Format for publication

`/Users/pablovoorvaart/Code/scout-admin/content/social/<slug>-linkedin.md`

```yaml
---
platform: linkedin
sourcePost: <blog-post-slug>     # which blog post this is derived from, if any
status: draft                    # draft | approved | published
scheduledFor: YYYY-MM-DD         # when to post (optional)
publishedAt: null                # ISO timestamp when posted
---

<post body — paste as-is into LinkedIn>
```

## Quality bar

Before approving a LinkedIn post:
- [ ] Line 1 would earn a click even without context
- [ ] Specific numbers, not vague claims
- [ ] Story or mechanism, not generic advice
- [ ] Scout mentioned once at most, as a natural fit
- [ ] Max 3 hashtags, at the bottom
- [ ] No "thought leader" cliches
