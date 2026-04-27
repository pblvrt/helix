---
name: search-console-scrape
description: Scrape Google Search Console Performance reports via Chrome. Extracts totals, top queries (up to 50), top pages (up to 20), and top countries for the configured property + date range. Use with pull-analytics task. Stop on CAPTCHA.
---

# Google Search Console Scrape

Pull Search Console performance data via the UI. Required for the `pull-analytics` task's "striking distance queries" analysis.

## When to use

- Task type `pull-analytics` — this skill handles the Search Console half
- User signed in with verified property `scout.pblvrt.com`

## Inputs

```json
{
  "propertyHint": "scout.pblvrt.com",
  "dateRange": "last-28-days",
  "tabs": ["queries", "pages", "countries"]
}
```

## Outputs

```json
{
  "property": "scout.pblvrt.com",
  "dateRange": "last-28-days",
  "totals": { "clicks": 412, "impressions": 28100, "ctr": 0.0147, "position": 18.3 },
  "topQueries": [
    { "query": "ai sdr for founders", "clicks": 24, "impressions": 1840, "ctr": 0.013, "position": 11.4 }
  ],
  "topPages": [
    { "page": "https://scout.pblvrt.com/blog/what-is-an-ai-sdr", "clicks": 180, "impressions": 9400, "ctr": 0.019, "position": 9.1 }
  ],
  "topCountries": [ { "country": "United States", "clicks": 210, "impressions": 14300 } ],
  "warnings": []
}
```

## Contract

**Does:**
1. Navigate to `https://search.google.com/search-console/`.
2. Select property matching `propertyHint`.
3. Open Performance → Search results.
4. Set date range. Default: last 28 days.
5. Extract totals from the top-of-page cards (Clicks, Impressions, CTR, Position).
6. Per requested tab (QUERIES, PAGES, COUNTRIES), click the tab header → scroll to ensure all rows load → `take_snapshot` → extract the visible rows.
7. Close the tab.

**Does NOT:**
- Click "Export" (same reason as ga-scrape).
- Compare vs. prior period (the caller computes deltas).
- Set up filters — read with whatever filters are already applied; caller handles the default-filter case.

## Safety

- Never switch properties. Abort if the target property isn't in the list.
- Never click into a URL inspection tool — read-only.
- Stop on CAPTCHA (extremely rare for GSC but possible).

## Common failure modes

- **Property not verified**: GSC won't show data. Log warning, return empty totals.
- **Sampling notice**: GSC may show "(results may be sampled)". Pass through as a `warnings[]` entry — don't halt.
- **Infinite scroll**: the QUERIES tab lazy-loads beyond the first 20 rows. Scroll the table container until `data-query-count` stops growing or we hit the requested limit (50).
