---
name: ga-scrape
description: Scrape Google Analytics 4 reports via Chrome (no API, no service account). Navigates to the configured property, opens Traffic Acquisition + Pages/Screens reports for the requested date range, extracts table rows via take_snapshot, returns structured JSON. Closes every tab. No Export clicks.
---

# Google Analytics 4 Scrape

Pull GA4 data via the UI. Used when the user is already signed in to GA4 in the debug Chrome session.

## When to use

- Task type `pull-analytics` — this skill handles the GA4 half
- Property must be selected (e.g. `scout.pblvrt.com`)
- User must be signed in

## Inputs

```json
{
  "propertyHint": "scout.pblvrt.com",
  "dateRange": "last-7-days",
  "reports": ["traffic-acquisition", "top-pages"]
}
```

## Outputs

```json
{
  "property": "scout.pblvrt.com",
  "dateRange": "last-7-days",
  "trafficAcquisition": [
    { "channelGroup": "Organic Search", "sessions": 4200, "users": 3100, "engagedSessions": 2800, "bounceRate": 0.42, "avgEngagementTime": 95, "conversions": 12 }
  ],
  "topPages": [
    { "pagePath": "/blog/what-is-an-ai-sdr", "views": 1820, "users": 1400, "avgEngagementTime": 112 }
  ],
  "warnings": []
}
```

## Contract

**Does:**
1. Chrome check.
2. Navigate to `https://analytics.google.com/analytics/web/`.
3. If the UI presents a property picker, match on `propertyHint`. Abort if no match with warning "property not found".
4. Reports → Life cycle → Acquisition → Traffic acquisition → set date range → `take_snapshot` → extract rows.
5. Reports → Engagement → Pages and screens → `take_snapshot` → extract rows.
6. Close every tab you opened.

**Does NOT:**
- Click "Export" — scraping the visible table is the contract (Export downloads a file that's harder to handle).
- Compare vs. previous period (caller does that using snapshot deltas).
- Pull attribution or audience reports (future extension).

## Safety

- Never click "Create custom report" — read-only.
- Never change the property, date range settings permanently (user's filters must be restored if changed — best effort).
- If a chart fails to load within 20s, note it as a warning and move on; don't block the whole run.

## Date range mapping

| Input | GA UI value |
|-------|-------------|
| `last-7-days`  | Last 7 days |
| `last-28-days` | Last 28 days (default in many reports) |
| `last-90-days` | Last 90 days |
| `today`        | Today |
