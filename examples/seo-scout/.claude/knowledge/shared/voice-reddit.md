# Reddit Voice Guide

Reddit is adversarial to marketing. One misstep = shadowban. This doc covers how to post on Reddit without triggering the "this is spam" reflex.

## Iron laws

1. **Never lead with the product.** If Scout shows up in the first 60% of the post, it's spam.
2. **Story > broadcast.** Reddit posts that open with "I tried X and here's what happened" outperform anything that reads like a pitch.
3. **Follow subreddit rules before posting.** Every sub has different rules. Check the sidebar and the sticky. Getting banned from r/SaaS is expensive.
4. **Build karma first.** New accounts with <50 karma get auto-filtered in most good subs. If posting from a fresh account, spend a week commenting before posting.
5. **Never cross-post verbatim.** Rewrite for each subreddit. Reddit's spam filter detects duplicates across subs.
6. **No engagement bait.** "Upvote if you agree" = instant shadowban.

## Subreddit-specific rules

### r/SaaS
- Strict no-self-promo outside "Self-Promotion Saturday" thread — check rules
- Posts must add value; "built X, what do you think" usually gets removed
- Pattern: Share a specific number or lesson. Let people DM for the product.
- Flairs matter — use "Build Story" or "Lessons Learned" not "Self Promo"

### r/sales
- Hostile to tools that threaten SDR jobs. Tread carefully with "AI SDR" framing.
- Pattern: Focus on workflow, not replacement. "How I do outbound as a founder" works.
- Avoid: "AI will replace SDRs"

### r/startups
- Medium tolerance for self-promo if wrapped in a lesson
- Must be a real lesson (specific numbers, real mistakes), not a thinly-veiled ad
- Pattern: "Here's what I got wrong building X" → mention Scout in comments if asked

### r/EntrepreneurRideAlong
- Most tolerant of build-in-public posts
- Pattern: Show the numbers (MRR, traffic, costs), tell the story
- Works well for Scout's indie-hacker positioning

### r/indiehackers (+ indiehackers.com)
- Very friendly to bootstrappers
- Pattern: Milestone posts ("hit $1k MRR," "got 100 users") + the full playbook
- Scout can be named in the post body — just once, early-to-middle

### r/SideProject
- Low bar for self-promo, high volume
- Pattern: Screenshot + 3-sentence pitch + link
- Good for quick launches, not for driving ongoing traffic

### r/smallbusiness
- Skews non-technical — explain Scout in business terms, not founder terms
- Avoid jargon: "AI SDR" doesn't land here; "automate LinkedIn outreach" does

### r/coldemail / r/SalesOperations
- Niche but qualified audience
- Pattern: Teach something specific ("how I write first messages that get 30% replies")
- Tools fit naturally in comments

## Post structure (universal)

### Title
- Specific, question-style or milestone-style
- Bad: "Check out my new tool"
- Good: "How I went from 0 to 32k monthly visitors in 30 days with zero marketing spend"
- Good: "Why I built my own LinkedIn tool instead of paying $500/mo for Apollo"

### Body — 3 parts

**1. The hook (first 2-3 sentences)**
- Specific situation, specific problem
- "I'm a solo founder. I was paying $500/mo for a sales tool. Here's what happened when I stopped."

**2. The story / lesson (majority of post)**
- Real numbers
- What you tried, what worked, what didn't
- Lessons someone could apply even if they never hear about Scout again

**3. The reveal (last 20%, optional)**
- Only if the subreddit allows self-promo
- Brief, matter-of-fact mention: "I built a tool called Scout to do this. $199 once. scout.pblvrt.com if useful."
- Never phrase as a pitch. Phrase as an aside.

### Comments strategy
- Reply to every comment within the first 2 hours (this is what drives ranking)
- Answer questions specifically, not "great question!"
- If someone asks "how does Scout compare to X," answer honestly including weaknesses
- Never argue with negative comments — respond with facts or say "fair point"

## Format for publication

One file per subreddit:
`/Users/pablovoorvaart/Code/scout-admin/content/social/reddit-<slug>-<sub>.md`

```yaml
---
platform: reddit
subreddit: r/SaaS
sourcePost: <blog-post-slug>
status: draft                    # draft | approved | published
title: "exact reddit title"
flair: "Build Story"             # if sub uses flairs
scheduledFor: YYYY-MM-DD
publishedAt: null
commentResponses: []              # pre-drafted responses to common questions
---

<post body>
```

## Cadence rules

- **Max 1 post per subreddit per week.** More = spam detection.
- **Stagger across days:** Mon r/SaaS → Tue r/startups → Wed r/indiehackers → etc. Never same-day spray.
- **Different angle per sub.** r/SaaS gets "here's the SaaS lesson," r/sales gets "here's the sales lesson" from the same source blog.
- **Track karma and comments.** If a sub consistently downvotes Scout posts, stop posting there.

## Banned moves

- Cross-posting the same text to multiple subs
- Any phrase that reads like marketing copy ("supercharge," "game-changer," "revolutionary")
- Upvote manipulation (asking friends, using alt accounts)
- Replying to your own post with "Has anyone tried X?" from an alt account
- Posting 3+ times in a week to the same sub
- Arguing with moderators about post removal
