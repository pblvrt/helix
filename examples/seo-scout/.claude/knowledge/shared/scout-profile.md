# Scout — Product Profile (Source of Truth)

All copy that mentions Scout in blog posts, social posts, Reddit posts, and directory submissions MUST pull from this file. Never invent features or stats.

## Basics

- **Name:** Scout
- **URL:** https://scout.pblvrt.com
- **Founder:** Pablo Voorvaart (pablo@streameth.org)
- **Category:** AI SDR / lead generation / sales automation
- **Pricing model:** One-time purchase desktop app (see Pricing section)
- **Platform:** macOS (Apple Silicon + Intel), Windows, Linux
- **Launched:** 2026

## Tagline

> AI-powered LinkedIn lead generation that runs on your Mac, not in the cloud.

## Description — 50 words

Scout is an AI SDR that runs locally on your computer and automates LinkedIn prospecting end-to-end. It finds qualified leads via Sales Navigator, scores them against your ICP, drafts personalized opening messages, and sends connection requests — all from a desktop app you own, not a SaaS subscription.

## Description — 100 words

Scout is a desktop AI SDR for solo founders and consultants who need consistent LinkedIn outreach but hate the cost and cloud-risk of SaaS tools like Clay, Instantly, or Apollo. It runs locally on your Mac, uses your own LinkedIn session, and orchestrates Sales Navigator searches, X-ray Google searches, and profile enrichment to build a qualified pipeline on autopilot. Every lead is scored against your ICP, gets a personalized first message, and lands in a local CRM you control. No subscriptions, no shared data, no bans from risky server-side automation.

## Description — 250 words

Scout is an AI SDR you install on your Mac. Built for solo founders, consultants, and small sales teams who want the power of an Apollo or Clay workflow without paying $500/month, sharing their LinkedIn session with a cloud vendor, or risking account bans from server-side automation.

Here's how it works: you give Scout a goal ("find B2B SaaS founders in Berlin, Series A, hiring sales"). Scout orchestrates three parallel search strategies — Sales Navigator, X-ray Google search, and targeted web discovery — to assemble a candidate list. Each candidate is auto-scored against your ICP with a two-pass qualification: buyer vs seller, then deep enrichment for the survivors. Scout drafts a personalized opening message for every qualified lead referencing their specific role, company, and trigger event. Leads land in a local SQLite CRM with full provenance (search URL, signal, score, trigger evidence).

You approve who gets a connection request. Scout sends them via your logged-in LinkedIn Chrome session — no cookies leave your machine, no headless browser farm, no third-party server ever touches your account. When someone replies, Scout stops all automation for that lead immediately (human takeover).

One-time purchase. No subscription. Updates delivered via the app. Your data stays on your disk.

If you're a solo founder who's done paying a sales tool more than your AWS bill, Scout is for you.

## Features (the truth — don't invent)

- LinkedIn Sales Navigator automation (search, filter, extract)
- X-ray Google search (`site:linkedin.com/in`) for profile-text matching
- Web discovery (events, funding, hiring — via WebSearch + WebFetch)
- Two-pass qualification (buyer-vs-seller pre-filter, then ICP scoring)
- First-message generation personalized per lead
- Local SQLite CRM with Kanban pipeline (discovered → approved → connection sent → replied)
- Connection request automation via Chrome remote debugging (port 9222)
- Conversation detection — skips leads you already have a thread with
- Reply detection → HUMAN_TAKEOVER — all automation stops for that lead
- CAPTCHA detection → stop all automation immediately
- Cron scheduling for recurring discovery/outreach
- Claude Code agent runtime (you can add custom commands)

## What Scout is NOT (never claim these)

- Not a cloud SaaS
- Not a Chrome extension (it's an Electron desktop app)
- Not email outreach (LinkedIn only, for now)
- Not a CRM integration platform (Salesforce/HubSpot sync is not a feature)
- Not a database of leads — you build your own list
- Not GDPR-compliant "out of the box" — you are the data controller; Scout just runs on your machine

## Pricing

- **One-time:** $199 (lifetime license, lifetime updates)
- **Multi-seat:** $399 for up to 5 seats
- No subscription option. No free tier. 30-day refund.

(Confirm with Pablo before quoting; this is the current public pricing.)

## Differentiators (used in comparison posts, directory submissions)

vs Apollo / Instantly / Clay / Smartlead:
- Runs locally — your LinkedIn session never leaves your device
- One-time purchase — $199 vs $500+/month
- You own the leads, the code path, the automation logic
- No shared IPs, no cloud browser farm, no rate-limit roulette

vs Taplio / Dripify / Dux-Soup:
- Full AI SDR loop, not just DM automation
- ICP-aware scoring, not just volume sending
- Human-in-the-loop approvals and reply detection built in

vs building your own:
- Claude Code agent runtime included — you customize by dropping markdown files, not writing Puppeteer

## Screenshots (hosted at scout.pblvrt.com/screenshots/)

- `dashboard.png` — Kanban pipeline
- `goal-create.png` — goal creation flow
- `agent-stream.png` — live agent log stream
- `schedule.png` — cron scheduling UI
- `lead-detail.png` — enriched lead card with first-message

## Links for directories + social

- Website: https://scout.pblvrt.com
- Twitter/X: [ADD HANDLE]
- LinkedIn: [ADD COMPANY PAGE]
- GitHub: [ADD IF PUBLIC]
- Changelog: https://scout.pblvrt.com/changelog
- Docs: https://scout.pblvrt.com/docs
- Pricing: https://scout.pblvrt.com/pricing

## SEO keyword pillars (what Scout should rank for)

**Primary pillar — AI SDR:**
- ai sdr
- ai sdr tool
- ai sdr for founders
- ai sdr vs human sdr
- best ai sdr 2026

**Secondary pillar — local-first sales automation:**
- local sales automation
- linkedin automation without cloud
- desktop linkedin tool
- self-hosted sdr
- ai sales agent on mac

**Tertiary pillar — LinkedIn lead generation (long-tail):**
- sales navigator automation
- linkedin prospecting for solo founders
- ai lead scoring
- signal-based prospecting
- buyer vs seller linkedin search

**Comparison pillar (high buyer-intent):**
- apollo alternative
- instantly alternative
- clay alternative
- taplio alternative
- dripify alternative

**Ignore (too broad / owned by incumbents):**
- "lead generation"
- "sales tools"
- "crm"
- "linkedin tool"

## Ideal Customer Profile

- Solo founder or 2-5 person SaaS/consulting team
- Sells B2B, high-ticket ($500+ ACV)
- Does own outbound (no SDR hired)
- Already on Sales Navigator or considering it
- Has hit LinkedIn's connection limit / been rate-limited / had account restricted
- Tried Apollo/Instantly, churned on price or data privacy concerns
- Indie hacker / bootstrapper mindset — prefers ownership to subscription

## Things Pablo has said publicly (voice)

- "SaaS SDR tools are a 90% margin business. You're paying for their marketing, not their code."
- "Your LinkedIn session is the most valuable cookie on your computer. Don't give it to a server farm."
- "AI SDR doesn't mean autopilot. It means the boring 80% is automated, so you can be the human for the 20% that matters."
- "If you can afford a $500/month sales tool, you don't need Scout. If you can't, you do."
