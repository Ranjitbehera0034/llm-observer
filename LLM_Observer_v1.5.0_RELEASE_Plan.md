# LLM Observer — Release v1.5.0 Complete Plan

## Network Monitor — Per-App Attribution

**Version type:** Minor (new feature, fully backward compatible)
**Previous release:** v1.4.0 (Per-Provider Budgets + Alerts)
**Estimated effort:** 5-6 days
**Risk level:** Medium-High (OS-level network inspection, cross-platform compatibility, probabilistic correlation)

---

## 1. What this release does — in plain language

After v1.4.0, a developer sees: "You spent $4.20 on Anthropic today." But they don't know whether that came from Claude Code, Cursor, Continue, or a background script.

After v1.5.0, the dashboard shows: "Cursor: $2.80 (67%) | Claude Code: $0.95 (23%) | Node script: $0.45 (10%)."

This is the feature that no competitor offers. Helicone, Langfuse, and LangSmith track requests from one application at a time. LLM Observer sees ALL applications on the machine simultaneously and tells you which one is costing you money.

---

## 2. How network monitoring actually works

### 2.1 The core mechanism

Every outgoing TCP connection on your machine has a source process. The operating system knows which process ID (PID) opened which socket to which destination IP address. This information is available through standard system commands — no kernel hacking, no root access, no packet interception.

LLM Observer runs a background scanner every 5 seconds that:
1. Lists all active TCP connections with their owning process
2. Filters for connections to known AI API IP addresses
3. Logs which application connected to which provider at what time

This is purely passive observation. It does NOT:
- Read the contents of any network packet
- Perform man-in-the-middle interception
- Inject itself into the TLS handshake
- Modify any traffic
- Require root/sudo/administrator privileges for basic functionality

### 2.2 Platform-specific implementation

**macOS:**
Uses `lsof -i -n -P` which lists all internet connections with process names and PIDs. No special permissions required. Available on every macOS installation by default.

Sample output we parse:
```
cursor    4821 ranjit   23u  IPv4  TCP  192.168.1.5:52341->104.18.6.192:443 (ESTABLISHED)
node      5102 ranjit   18u  IPv4  TCP  192.168.1.5:52400->104.18.7.44:443 (ESTABLISHED)
```

From this we extract: process name "cursor", PID 4821, destination IP 104.18.6.192, port 443.

**Linux:**
Uses `ss -tp state established` which lists established connections with process info. Available via the `iproute2` package (installed by default on virtually all Linux distributions). No special permissions required.

Sample output we parse:
```
ESTAB  0  0  192.168.1.5:42180  104.18.6.192:443  users:(("cursor",pid=4821,fd=23))
```

**Windows:**
Uses PowerShell `Get-NetTCPConnection` combined with `Get-Process` to correlate connections with process names. May require elevated (Administrator) prompt for full process visibility.

For v1.5.0: macOS and Linux are fully supported. Windows has basic support with a note that some connections may not show process names without elevation.

### 2.3 Known AI API domains we monitor

```
api.anthropic.com          → provider: "anthropic"
api.openai.com             → provider: "openai"
generativelanguage.googleapis.com → provider: "google"
api.mistral.ai             → provider: "mistral"
api.groq.com               → provider: "groq"
api.together.xyz           → provider: "together"
api.fireworks.ai           → provider: "fireworks"
api.deepseek.com           → provider: "deepseek"
api.cohere.com             → provider: "cohere"
```

These domains are resolved to IP addresses via DNS at monitor startup and re-resolved every 10 minutes (because CDN providers rotate IPs). When a connection's destination IP matches one of these resolved IPs, we log it.

### 2.4 The correlation logic — connecting "which app" to "how much"

The network monitor tells us WHEN an app connected to WHICH provider. The sync data (from v1.1.0/v1.2.0) tells us HOW MUCH was spent per provider per time bucket.

**Correlation approach:**

For each sync usage bucket (e.g., "Anthropic, claude-sonnet-4, 2026-03-22, 145 requests, $2.80"):
1. Find all network connections to Anthropic during that time period
2. Count connections per application: Cursor had 98 connections, Claude Code had 42, Node.js had 5
3. Attribute cost proportionally by connection count: Cursor ≈ 98/145 × $2.80 = $1.89, Claude Code ≈ 42/145 × $2.80 = $0.81, Node.js ≈ 5/145 × $2.80 = $0.10

**This is an approximation, not exact attribution.** Connection count is a proxy (no pun intended) for request count, but:
- One connection may carry multiple HTTP/2 requests
- One connection may be a long-lived WebSocket
- Some connections are health checks or metadata calls, not actual API requests

The accuracy is roughly 80-90% for individual developers who use one tool at a time. It degrades when multiple tools hit the same provider simultaneously.

### 2.5 What this CAN and CANNOT attribute

**For BYOK tools (Claude Code, Continue, Aider, custom scripts):**
Network monitor sees the connection. Sync data shows the cost. Correlation gives per-app attribution with actual dollar amounts.
Result: "Claude Code spent $0.95 on Anthropic today."

**For subscription tools (Cursor Pro subscription, GitHub Copilot):**
Network monitor sees the connection. But sync data shows NOTHING (billed to the tool's own account, not the user's).
Result: "Cursor made ~340 connections to Anthropic today. Exact cost unknown — included in your Cursor Pro subscription."

This is still valuable. A developer can see: "Cursor is making 340 API calls a day on my behalf. That's a lot of activity for $20/month — the subscription is worth it." Or: "Cursor is making only 12 API calls a day. Maybe the free tier would be enough."

**For tools that route through their own servers (JetBrains AI, some Copilot configurations):**
Network monitor sees a connection to JetBrains' server, NOT to api.openai.com. This connection is not to a known AI domain, so it's invisible.
Result: No attribution. Completely invisible.

---

## 3. Proposed changes — component by component

### 3.1 Database changes

**New migration file.**

**New table: `app_connections`**
Stores detected network connections to AI API endpoints.

| Column | Purpose |
|--------|---------|
| id (auto-increment) | Row identifier |
| timestamp | When the connection was detected (ISO 8601) |
| process_name | Raw process name from OS: "cursor", "code", "node", "python3" |
| process_pid | Process ID |
| provider | Mapped provider: "anthropic", "openai", "google", etc. |
| destination_ip | IP address of the AI API endpoint |
| destination_port | Port (usually 443) |
| created_at | When this record was inserted |

**Deduplication constraint:** We don't want to log the same persistent connection every 5 seconds. A unique constraint or deduplication check on (process_name, provider, 30-second window) ensures we log at most one record per process per provider per 30 seconds.

**New table: `app_aliases`**
Maps raw process names to human-friendly display names.

| Column | Purpose |
|--------|---------|
| process_name (primary key) | Raw name: "cursor", "code", "node" |
| display_name | Friendly name: "Cursor", "VS Code", "Node.js Script" |
| icon | Optional icon identifier for the dashboard |
| created_at | When this alias was created |

Pre-populated with common AI development tools:

| Process name | Display name |
|-------------|-------------|
| cursor | Cursor |
| code | VS Code |
| code-insiders | VS Code Insiders |
| node | Node.js Script |
| python | Python Script |
| python3 | Python Script |
| idea | IntelliJ IDEA |
| webstorm | WebStorm |
| pycharm | PyCharm |
| claude | Claude Code |
| aider | Aider |

Users can add custom aliases for unrecognized process names via the dashboard.

**Indexes:**
- `app_connections(timestamp DESC, provider)` — for time-range queries
- `app_connections(process_name, timestamp DESC)` — for per-app queries

### 3.2 Network monitor service

**New module: network monitor.**

A background service that runs alongside the proxy and sync pollers. It has three responsibilities:

**Responsibility 1 — DNS resolution.**
At startup, resolve all known AI API domains to their IP addresses. Store the mapping in memory. Re-resolve every 10 minutes because CDN providers (Cloudflare, AWS CloudFront) rotate IPs frequently. Log when IPs change (useful for debugging "why did attribution stop working").

**Responsibility 2 — Connection scanning.**
Every 5 seconds, run the platform-specific scan command (lsof on macOS, ss on Linux). Parse the output. For each connection:
- Check if the destination IP matches any known AI API IP
- If yes, check if we've already logged this (process_name, provider) in the last 30 seconds
- If not logged recently, insert a record into app_connections

**Responsibility 3 — Graceful degradation.**
If the scan command fails (permission denied, command not found, timeout), log the error and continue. Don't crash. Don't spam error logs (log at most once per minute). Show the user: "Network monitor: limited functionality. [Specific reason]."

### 3.3 Feature flag — OFF by default

Network monitoring is disabled by default. The user must explicitly enable it in Settings. This is important because:

- It runs a system command every 5 seconds — some users may not want that
- It reveals which applications are making network connections — privacy-sensitive
- It requires the user to understand what it can and cannot do before enabling

**Enabling:** Settings page has a toggle: "Per-app tracking — Monitor which applications connect to AI APIs."

Below the toggle, a clear explanation: "When enabled, LLM Observer checks every 5 seconds which applications on your machine are connecting to AI API endpoints (like api.anthropic.com and api.openai.com). This helps attribute your AI spending to specific tools. All data stays local on your machine. No traffic content is inspected."

**Disabling:** Toggle off. Monitor stops immediately. Existing connection data is preserved in the database for historical viewing. No background process remains.

### 3.4 Correlation engine

**New module: app cost correlator.**

Runs after each sync poll (when new usage data arrives) and on dashboard page load (when the user views the Apps page).

**Algorithm:**

For a given time period (today, this week, etc.):

1. Load sync usage data grouped by provider and time bucket
2. Load app connection counts grouped by provider, process_name, and time bucket
3. For each (provider, time_bucket) pair:
   a. Total sync cost for this bucket: C
   b. Total connection count across all apps for this bucket: N
   c. For each app: app_connections / N × C = estimated app cost
4. Aggregate across all time buckets to get per-app totals

**Handling the ambiguous case:**

When two apps connect to the same provider in the same time bucket and we can't determine which made more requests:

- If connection counts are available: attribute proportionally (as above)
- If only one app shows connections: attribute 100% to that app
- If no apps show connections (monitor was off, or connections were too brief to catch): mark as "Unattributed"

The dashboard always shows an "Unattributed" row for any spend that couldn't be mapped to an app. This is honest — we don't hide the uncertainty.

### 3.5 API routes

**New routes:**

`GET /api/apps` — Per-app spending summary for a given period. Returns:
```
{
  period: "today",
  apps: [
    { process_name: "cursor", display_name: "Cursor", estimated_cost_usd: 2.80, connection_count: 340, pct: 67 },
    { process_name: "claude", display_name: "Claude Code", estimated_cost_usd: 0.95, connection_count: 42, pct: 23 },
    { process_name: "node", display_name: "Node.js Script", estimated_cost_usd: 0.45, connection_count: 5, pct: 10 }
  ],
  unattributed_usd: 0.00,
  note: "Attribution is estimated based on connection frequency. Accuracy: ~85-90%."
}
```

Query params: `?period=today|week|month`, `?provider=anthropic|openai`

`GET /api/apps/:process_name/detail` — Detailed view for one app. Returns: daily cost timeline, provider breakdown, model breakdown (if the sync data supports model-level grouping).

`PUT /api/apps/:process_name/alias` — Set a custom display name for a process. Useful when the user sees "node" and wants it to say "My Batch Script."

`GET /api/network/status` — Monitor status: running/stopped, platform, scan interval, last scan time, number of known AI API IPs.

`POST /api/network/start` — Enable the network monitor.

`POST /api/network/stop` — Disable the network monitor.

### 3.6 Dashboard changes

**New "Apps" page in the navigation.**

`[Overview] [Apps ★NEW] [Projects] [Logs] [Sync] [Settings]`

**Apps page layout:**

**Top section — enable prompt (if monitor is off):**
"Enable per-app tracking to see which tools are driving your AI spend."
[Enable] button → starts the monitor.

If the monitor hasn't been on long enough to collect meaningful data (less than 1 hour): "Per-app tracking is collecting data. Check back in an hour for your first breakdown."

**Main section — per-app breakdown (when data is available):**

A horizontal bar chart showing each app's estimated spend, sorted by cost:

```
Cursor          $2.80  ████████████████████  67%
Claude Code     $0.95  ███████              23%
Node.js Script  $0.45  ███                  10%
Unattributed    $0.00                        0%
```

Each bar is clickable — opens the detail view for that app.

**Detail panel (when an app is clicked):**
- Daily spend trend for this app (last 30 days)
- Provider breakdown: "Cursor → Anthropic: $2.40, OpenAI: $0.40"
- Connection frequency: "Average 340 connections/day to AI APIs"
- Editable display name: "Click to rename 'cursor' to 'My Cursor'"

**Subscription tool insight (new in this release):**

For apps where the network monitor sees connections but sync shows no corresponding cost (indicating subscription-model usage), show a special card:

"Cursor (subscription mode): ~340 connections to Anthropic today. This traffic is billed to your Cursor subscription, not your API account. Estimated equivalent API cost: ~$4.20/day based on average request size."

This gives the developer a sense of whether their subscription is worth the money.

**Data freshness note:**
At the bottom of the Apps page: "Per-app attribution is estimated from network activity and Usage API data. Accuracy is approximately 85-90%. Data updates every 60 seconds."

### 3.7 Integration with Overview page

The Overview page (from v1.3.0) gets a new optional section when the network monitor is enabled:

**"Top apps today" mini-panel:**
Shows the top 3 apps by cost, inline with the existing overview layout. Clicking "See all" navigates to the full Apps page.

This is a small addition — 3 lines of text on an existing page — but it makes per-app data visible without requiring the user to navigate to a separate page.

---

## 4. Error handling and edge cases

### 4.1 Platform-specific failures

| Scenario | Platform | What happens |
|----------|----------|-------------|
| `lsof` command not found | macOS | Should never happen (built into macOS). If it does: disable monitor, show "Required system tool not available." |
| `ss` command not found | Linux | Show: "Install iproute2 package for network monitoring: `sudo apt install iproute2`" |
| Permission denied on `lsof` | macOS | Rare. Show: "Network monitor needs permission to list connections. Try running LLM Observer with elevated privileges." |
| Permission denied on `ss` | Linux | Show: "Network monitor cannot read connection info. Try: `sudo setcap cap_net_admin+ep $(which ss)`" |
| PowerShell not available | Windows | Disable monitor on Windows. Show: "Network monitoring requires PowerShell. Windows support is limited in this version." |
| Scan command takes too long (>3 seconds) | Any | Skip this scan cycle. Log a warning. Don't block the next cycle. |
| Scan command returns empty | Any | Normal — no AI connections active right now. Not an error. |

### 4.2 DNS resolution failures

| Scenario | What happens |
|----------|-------------|
| DNS resolution fails for one domain | Use cached IPs from last successful resolution. Log warning. Re-attempt in 10 minutes. |
| DNS resolution fails for ALL domains | Monitor continues running but cannot match any connections. Dashboard shows: "Network monitor active but DNS resolution failed. Per-app attribution temporarily unavailable." |
| IP addresses change (CDN rotation) | Re-resolution every 10 minutes catches this. Brief gap (up to 10 min) where new IPs aren't matched. |
| Domain resolves to multiple IPs (load balancing) | Store ALL resolved IPs. Match against any of them. |
| IPv6 addresses | Resolve both A (IPv4) and AAAA (IPv6) records. Match connections against both. |

### 4.3 Process identification edge cases

| Scenario | What happens |
|----------|-------------|
| Process name is "node" — could be any Node.js script | Log as "node" with PID. Dashboard shows "Node.js Script" by default. User can rename to "My Batch Script" via the alias feature. |
| Process name is "python3" — could be anything | Same approach — default alias, user can rename. |
| Process exits before next scan | Connection logged during the scan when it was active. If the process terminates between scans, we miss it. Mitigation: 5-second scan interval catches most connections that last more than a few seconds. Very short-lived connections (<5 seconds) may be missed. |
| Electron app shows as "Electron" not "Cursor" | On some systems, Electron-based apps report as "Electron" or "Helper". Try to resolve the actual app name from the PID by reading the process command line. Fallback to raw process name if unavailable. |
| Docker container makes API calls | Container processes may show as the container's PID namespace, not the host process. On Linux, `ss` may show the container process. On macOS, Docker Desktop's VM may obscure it. Log as "docker" or the container process name. |
| Multiple instances of same app (two VSCode windows) | Both show as "code" with different PIDs. Connection counts are summed under the same process name. This is correct — both windows contribute to VSCode's cost. |

### 4.4 Correlation edge cases

| Scenario | What happens |
|----------|-------------|
| Two apps hit same provider in same minute | Attribute proportionally by connection count. If Cursor had 80 connections and Claude Code had 20, Cursor gets 80% of the cost. |
| App connects but makes zero API calls (just a health check) | The connection is counted. It slightly inflates that app's attributed cost. Accepted inaccuracy — health checks are typically infrequent. |
| Sync data has daily buckets but connections are per-second | Aggregate connection counts to match the sync bucket width. If sync gives daily cost, sum all connections for that day per app. |
| No connections logged for a period that has sync cost | All cost for that period goes to "Unattributed." This happens when: monitor was off, connections were too brief, or the tool routes through a non-standard domain. |
| Connection count exceeds sync request count | Possible if one tool polls frequently (e.g., checking for updates). Doesn't break the math — proportional attribution still works, just means that tool's per-connection cost is lower. |

---

## 5. Privacy and security considerations

### 5.1 What the monitor sees

- Process name (e.g., "cursor")
- Process ID (e.g., 4821)
- Destination IP address (e.g., 104.18.6.192)
- Destination port (e.g., 443)
- Timestamp

### 5.2 What the monitor does NOT see

- Request content (prompts, messages)
- Response content
- HTTP headers (including API keys)
- TLS certificate details
- Any content inside the encrypted connection
- Other non-AI network connections (filtered out immediately)

### 5.3 Data storage

All connection data stays in the local SQLite database. It is never sent to any external server. The data is:
- Stored unencrypted (it's not sensitive — just process names and IP addresses)
- Subject to the same data retention policy as other tables (auto-compact after 30 days)
- Deletable by the user at any time (clear data button in Settings)

### 5.4 User consent model

The monitor is OFF by default. Enabling it requires explicit user action (toggle in Settings). The toggle includes a clear explanation of what the monitor does. There is no passive or automatic enabling.

When the user enables the monitor, they are consenting to: "LLM Observer will check every 5 seconds which applications on my machine are connecting to AI API endpoints. This data stays local."

---

## 6. Positive scenarios

### 6.1 Developer discovers Cursor is their biggest expense

Developer enables per-app tracking. After one day, the Apps page shows: "Cursor: $4.20/day (72% of API spend)." They didn't realize Cursor was making so many API calls with their BYOK key. They check Cursor's settings and discover it's using Claude Opus for autocomplete. They switch to Sonnet. Daily spend drops from $4.20 to $1.60.

### 6.2 Developer finds a forgotten background script

The Apps page shows an entry: "Node.js Script: $1.80/day." The developer doesn't remember running any Node.js script. They check the PID, find it's a cron job they set up weeks ago for data analysis that runs every hour. It's been silently burning $54/month. They optimize the script to run daily instead of hourly. Cost drops to $1.80/month.

### 6.3 Developer validates their Cursor subscription value

The Apps page shows: "Cursor (subscription mode): ~500 connections/day to Anthropic. Estimated equivalent API cost: ~$6.20/day = ~$186/month." Their Cursor Pro subscription costs $20/month. The subscription is providing $186/month of API value. Good deal — worth keeping.

### 6.4 Developer discovers even split between tools

Apps page shows: "Cursor: 40%, Claude Code: 35%, VS Code Continue: 25%." The developer expected Claude Code to dominate. Turns out they use Cursor more than they thought. This insight helps them decide which tool to invest time learning better.

---

## 7. Negative scenarios

### 7.1 Monitor shows "Unattributed: 100%"

Developer enables the monitor. After a day, all spend shows as "Unattributed." No apps are attributed.

**Possible causes:**
1. The monitor failed to resolve AI API domain IPs (DNS issue)
2. The tools route through non-standard domains not in our list
3. The scan command doesn't have permission to see connections
4. Connections are too brief for the 5-second scan to catch

**Mitigation:** The Network Status panel (accessible from the Apps page) shows diagnostic info: "Known AI IPs: 24 resolved. Last scan: 3 seconds ago. Connections found this scan: 0." This helps the user debug the issue.

If zero connections are ever found after 1 hour of the monitor being active: show a diagnostic suggestion: "No AI connections detected in the last hour. Possible reasons: (1) No AI tools are running right now. (2) Your tools may route through servers not in our domain list. (3) Check Network Status for DNS resolution details."

### 7.2 Monitor attributes cost to wrong app

Two apps connect to Anthropic simultaneously. Cursor makes 50 connections (lots of small autocomplete requests). Claude Code makes 5 connections (a few large, expensive requests). Proportional attribution assigns 91% to Cursor and 9% to Claude Code. But the actual cost might be 30% Cursor, 70% Claude Code (because Claude Code's requests used Opus with large contexts).

**This is a known limitation.** Connection count is NOT the same as request cost. The dashboard always shows: "Attribution is estimated. Accuracy: ~85-90%." For exact per-app tracking, the v1.8.0 VSCode extension captures token counts at the source.

**Mitigation for this release:** When the monitor detects that multiple apps are connecting to the same provider simultaneously, show a small warning: "Multiple apps used Anthropic concurrently. Attribution may be less accurate for this period."

### 7.3 Performance impact on the machine

The `lsof` or `ss` command runs every 5 seconds. On a machine with thousands of connections, this could be slow.

**Measured impact:** On a typical developer machine with 100-300 active connections, `lsof -i -n -P` takes 50-200ms. `ss -tp` takes 10-50ms. Neither is noticeable.

**Risk case:** A developer running a server with 10,000+ connections. `lsof` might take 1-2 seconds.

**Mitigation:** If a scan takes more than 2 seconds, automatically reduce scan frequency to every 15 seconds. Log: "Network monitor scan taking longer than expected. Reducing frequency to every 15 seconds." The user can also configure the scan interval in Settings (5s, 10s, 15s, 30s).

### 7.4 Monitor detects connections but sync data shows $0

Developer's Cursor Pro subscription makes connections to api.anthropic.com. The monitor logs: "Cursor: 340 connections to Anthropic." But the sync data shows $0 for Anthropic (because Cursor is using its own key, not the user's).

**What happens:** The correlation engine finds connections with no matching sync cost. It creates a special "subscription mode" entry: "Cursor appears to be using a subscription or its own API key. 340 connections detected but no cost on your account."

This is the correct behavior. It's useful information — the developer can see how actively their subscription tools use AI, even without cost data.

### 7.5 App names are confusing

Developer sees entries like: "Electron Helper", "Python", "node", "code helper (renderer)". These are not meaningful to a non-technical user.

**Mitigation:** The pre-populated aliases table maps common process names to friendly names. For unrecognized names, show them raw with a "Rename" button. Over time, the user customizes aliases for their specific setup.

Future enhancement: community-contributed alias database that ships with updates.

---

## 8. Testing requirements

### 8.1 Regression tests (must all pass unchanged)

- All tests from v1.0.12 through v1.4.0
- Specifically: budget alerts still fire correctly (the network monitor doesn't interfere with the budget system)

### 8.2 New tests for v1.5.0

**Network monitor tests:**
- Parse macOS `lsof` output correctly (use fixture of real lsof output)
- Parse Linux `ss` output correctly (use fixture of real ss output)
- Identify AI API connections (destination IP matches resolved domain)
- Ignore non-AI connections (connections to google.com, github.com, etc.)
- Deduplication: same process+provider within 30 seconds → only one record
- DNS resolution: resolve all AI API domains → store IP mappings
- DNS re-resolution: after 10 minutes, re-resolve → update mappings
- DNS failure for one domain: use cached IPs, continue monitoring
- DNS failure for all domains: monitor runs but finds no matches, shows warning
- Scan timeout (>3 seconds): skip cycle, log warning, continue
- Scan returns empty output: not an error, no records inserted
- Monitor start → stop → no lingering background process

**Correlation tests:**
- 100 connections from one app, sync shows $5 → app attributed $5 (100%)
- 80 connections from Cursor, 20 from Claude Code, sync shows $5 → Cursor gets $4, Claude Code gets $1
- Zero connections in a period with $3 sync cost → $3 goes to "Unattributed"
- Monitor was off for part of the day → periods without connections show as "Unattributed"
- Connections exist but no sync data (subscription mode) → special "subscription detected" entry

**App alias tests:**
- Default aliases load correctly (cursor → "Cursor", code → "VS Code")
- PUT /api/apps/:name/alias → custom name saved and returned in subsequent queries
- Unknown process name → shown raw, with rename option

**API route tests:**
- GET /api/apps returns per-app breakdown with estimated costs
- GET /api/apps with monitor disabled → returns empty with "Monitor not enabled" message
- GET /api/apps/:name/detail returns daily timeline and provider breakdown
- GET /api/network/status returns correct state (running/stopped, platform, scan interval)
- POST /api/network/start → monitor starts → subsequent GET /api/network/status shows running
- POST /api/network/stop → monitor stops → status shows stopped

**Integration tests:**
- Enable monitor → make real connections (or mock them) → verify they appear in app_connections table
- Sync poller runs → budget evaluator runs → app correlator runs → dashboard shows per-app data
- Network monitor failure does not crash the proxy or sync pollers

### 8.3 Manual verification

1. Enable network monitor in Settings
2. Open Cursor / Claude Code / VS Code with Continue → make AI requests
3. Check Apps page → verify applications appear with connection counts
4. After sync data arrives (60s) → verify estimated costs appear
5. Rename a process (e.g., "node" → "My Batch Script") → verify change persists
6. Disable monitor → verify it stops (check no background process with `ps aux | grep lsof`)
7. Re-enable → verify historical data still shown
8. Check Network Status panel → verify DNS resolution, scan timing, IP count
9. Overview page → verify "Top apps today" mini-panel appears
10. Verify all existing features (proxy, sync, budgets, alerts, subscriptions) work unchanged

---

## 9. What this release does NOT include

| Feature | Deferred to | Why |
|---------|-------------|-----|
| Per-app budgets ("$3/day from Cursor") | Future | Requires reliable attribution — current accuracy (~85-90%) is too uncertain for hard limits |
| Windows full support | v1.5.1 patch | PowerShell approach needs more testing on various Windows versions |
| Byte-level traffic estimation | Future | Would require packet inspection (TLS content is encrypted anyway) |
| Community alias database | Future | Need to build update mechanism first |
| Network traffic graph visualization | Future | Nice-to-have UI enhancement |
| Automatic subscription detection | Future | Detecting "this app uses subscription, not your key" could be more automated |

---

## 10. Release checklist

**Before development:**
- [ ] Verify all v1.4.0 tests pass on current main branch
- [ ] Test `lsof -i -n -P` on your macOS machine — confirm output format
- [ ] Test `ss -tp state established` on a Linux machine — confirm output format
- [ ] Resolve all AI API domain IPs manually — verify they match expected CDN providers

**During development:**
- [ ] New migration creates app_connections and app_aliases tables
- [ ] Network monitor implemented for macOS (lsof parser)
- [ ] Network monitor implemented for Linux (ss parser)
- [ ] Windows basic support implemented (or graceful skip)
- [ ] DNS resolution with 10-minute refresh implemented
- [ ] Connection deduplication (30-second window) working
- [ ] Correlation engine attributes cost by connection proportion
- [ ] Feature flag: monitor is OFF by default
- [ ] Settings toggle with clear explanation
- [ ] Apps page with bar chart, detail view, alias editing
- [ ] Subscription-mode detection for unmatched connections
- [ ] Overview page "Top apps today" mini-panel
- [ ] Network Status diagnostic panel

**Testing:**
- [ ] All regression tests pass (v1.0.12 through v1.4.0)
- [ ] All new network monitor tests pass
- [ ] All correlation tests pass including edge cases
- [ ] Manual verification steps 1-10 completed
- [ ] Tested on macOS (primary)
- [ ] Tested on Linux (at least one distro)
- [ ] Verified graceful degradation on Windows

**Release:**
- [ ] Version bumped to 1.5.0 in package.json
- [ ] CHANGELOG.md updated
- [ ] README updated: "See which app is costing you money — per-app AI spend attribution"
- [ ] Git tag created: v1.5.0
- [ ] npm publish
- [ ] Smoke test: enable monitor → use AI tools → verify per-app data appears

---

## 11. Why this release matters

v1.5.0 is the release that makes LLM Observer unique. Every other LLM cost tracking tool (Helicone, Langfuse, LangSmith) tracks one application at a time and requires SDK integration. LLM Observer is the only tool that:

1. Tracks ALL applications on the machine simultaneously
2. Requires zero changes to any application
3. Runs entirely locally with no cloud dependency
4. Attributes cost to specific applications automatically

This is the feature you lead with in marketing. This is the feature that makes developers say "wait, that's actually useful" instead of "oh, another cost tracker." This is the feature that justifies LLM Observer's existence as a separate product rather than just a worse version of Helicone.

The ~85-90% accuracy disclaimer is important — be honest about it. But 85% accurate per-app attribution with zero setup is infinitely better than 0% attribution, which is what every other tool offers for this use case.

---

## 12. Changelog

```markdown
## [1.5.0] - 2026-XX-XX

### Added
- **Per-app AI spend attribution** — See which applications (Cursor, Claude Code,
  VS Code, scripts) are driving your AI costs. No IDE changes needed.
- Network monitor that passively detects connections to AI API endpoints
- Proportional cost attribution based on connection frequency
- Subscription-mode detection for tools using their own API keys
- New "Apps" page in the dashboard with breakdown chart and detail views
- Custom app naming (rename "node" to "My Batch Script")
- "Top apps today" summary on the Overview page
- Network Status diagnostic panel
- Pre-populated aliases for 12 common AI development tools

### Changed
- Overview page includes a "Top apps" mini-panel when network monitor is enabled

### Fixed
- None

### Breaking changes
- None (all existing features work identically; network monitor is OFF by default)
```