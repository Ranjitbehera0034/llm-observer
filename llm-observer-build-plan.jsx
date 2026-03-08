import { useState } from "react";

const C = {
  bg: "#04090f",
  bgCard: "#0a1018",
  border: "#14222e",
  text: "#c0d0dc",
  textDim: "#4a6272",
  textBright: "#eaf2f8",
  green: "#3dffa0",
  blue: "#4ac8ff",
  orange: "#ffa347",
  red: "#ff5a5a",
  purple: "#b88aff",
  cyan: "#4affea",
  yellow: "#ffe24a",
  pink: "#ff6b9d",
};

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

// ── PHASE 1: CLI (Weeks 1-3) ──
const phase1 = {
  title: "PHASE 1: CLI + BROWSER DASHBOARD",
  subtitle: "Ship to npm. Get first users. Validate demand.",
  color: C.green,
  weeks: [
    {
      week: 1,
      title: "The Proxy Engine",
      goal: "A working local proxy that intercepts LLM calls, counts tokens, calculates cost, and logs everything to SQLite.",
      outcome: "Developer can route OpenAI/Claude calls through localhost:4000 and see costs in terminal.",
      days: [
        {
          day: "Day 1",
          title: "Project Setup + Monorepo",
          color: C.green,
          tasks: [
            { task: "Initialize monorepo with npm workspaces", time: "30 min", detail: "mkdir llm-observer && cd llm-observer && npm init -w packages/proxy -w packages/database -w packages/dashboard -w packages/cli" },
            { task: "Set up TypeScript config for all packages", time: "30 min", detail: "Shared tsconfig.base.json + per-package tsconfig.json extending it" },
            { task: "Set up ESLint + Prettier", time: "20 min", detail: "Consistent code style across all packages" },
            { task: "Initialize Git repo + .gitignore", time: "10 min", detail: "Ignore node_modules, dist/, *.db, .env" },
            { task: "Create packages/database — SQLite setup", time: "1.5 hr", detail: "Install better-sqlite3. Write migration 001_initial.sql with all 6 tables + indexes. Write db.init() function that creates ~/.llm-observer/data.db" },
            { task: "Seed model pricing data", time: "1 hr", detail: "Create seed/pricing.ts with current pricing for OpenAI (gpt-4o, gpt-4o-mini, o1, o3), Anthropic (opus, sonnet, haiku), Google (gemini-2.5-pro, flash), Mistral, Groq" },
            { task: "Write repository layer (requests.repo.ts)", time: "1.5 hr", detail: "insertRequest(), getRequests(filters), getStats(), getDailyBreakdown() — parameterized queries, no raw SQL in app code" },
          ],
          totalHours: "5.5 hrs",
        },
        {
          day: "Day 2",
          title: "Core Proxy — Intercept & Forward",
          color: C.green,
          tasks: [
            { task: "Create packages/proxy base structure", time: "30 min", detail: "Express server on port 4000. Health check endpoint at /health" },
            { task: "Build base provider interface", time: "1 hr", detail: "providers/base.ts — interface IProvider { parseRequest(), parseResponse(), getTokenCount(), calculateCost() }" },
            { task: "Implement OpenAI provider", time: "2 hr", detail: "providers/openai.ts — Parse /chat/completions requests. Extract model, messages. Forward to api.openai.com. Parse response usage.prompt_tokens + usage.completion_tokens. Calculate cost." },
            { task: "Implement Anthropic provider", time: "1.5 hr", detail: "providers/anthropic.ts — Parse /messages. Handle Anthropic's different auth header (x-api-key). Parse response usage object." },
            { task: "Build proxy routing logic", time: "1.5 hr", detail: "proxy.ts — Route /v1/openai/* → OpenAI provider, /v1/anthropic/* → Anthropic provider. Copy all headers. Forward request body unchanged." },
            { task: "Test with real API calls", time: "30 min", detail: "Write a test script that sends a real OpenAI request through the proxy. Verify response is identical to direct call." },
          ],
          totalHours: "7 hrs",
        },
        {
          day: "Day 3",
          title: "Token Counting + Cost Calculation + Logging",
          color: C.blue,
          tasks: [
            { task: "Build token counter module", time: "1.5 hr", detail: "token-counter.ts — For OpenAI: use response.usage directly. For Anthropic: use response.usage. For providers that don't return usage: estimate using tiktoken or character-based heuristic." },
            { task: "Build cost calculator", time: "1.5 hr", detail: "cost-calculator.ts — Look up model in model_pricing table → (prompt_tokens / 1M × input_cost) + (completion_tokens / 1M × output_cost). Handle unknown models gracefully." },
            { task: "Implement async logging", time: "1.5 hr", detail: "logger.ts — After forwarding response to client, async write to SQLite: project_id, provider, model, tokens, cost, latency, status. Non-blocking — never delay the response." },
            { task: "Add latency measurement", time: "30 min", detail: "Record start time before forwarding, end time when response complete. Store as latency_ms." },
            { task: "Add request/response body storage", time: "1 hr", detail: "Store full request and response JSON for debugging. Truncate if >50KB to save disk space." },
            { task: "Implement Google Gemini provider", time: "1.5 hr", detail: "providers/google.ts — Handle Gemini's different API format and token counting." },
          ],
          totalHours: "7.5 hrs",
        },
        {
          day: "Day 4",
          title: "Budget Guard + Kill Switch",
          color: C.orange,
          tasks: [
            { task: "Build budget guard middleware", time: "2 hr", detail: "budget-guard.ts — Before forwarding request: query today's total spend for this project. If >= daily_budget AND kill_switch=true → return HTTP 429 with clear error message. Log as 'blocked_budget'." },
            { task: "Implement projects repository", time: "1.5 hr", detail: "projects.repo.ts — createProject(), getProject(), updateBudget(), getCurrentSpend(). Handle default project for quick start." },
            { task: "Build alert manager", time: "2 hr", detail: "alert-manager.ts — Trigger at configurable threshold (default 80%). Send OS notification via node-notifier. Send webhook POST to Slack/Discord URL if configured." },
            { task: "Add Mistral + Groq providers", time: "1.5 hr", detail: "Both are OpenAI-compatible, so extend the OpenAI provider with different base URLs and pricing." },
            { task: "Test budget kill switch end-to-end", time: "1 hr", detail: "Set $0.01 budget, send requests until blocked. Verify error message, notification, and logging all work." },
          ],
          totalHours: "8 hrs",
        },
        {
          day: "Day 5",
          title: "Streaming Support + Edge Cases",
          color: C.purple,
          tasks: [
            { task: "Handle SSE streaming responses", time: "3 hr", detail: "stream-handler.ts — This is the hardest part. OpenAI/Anthropic support streaming via Server-Sent Events. You need to: forward the stream to client in real-time, buffer chunks to count tokens after stream completes, calculate cost once stream is done." },
            { task: "Handle error responses gracefully", time: "1.5 hr", detail: "If LLM provider returns 429 (rate limit), 500, etc. — log the error, still return it to the client transparently. Don't crash." },
            { task: "Add request tagging", time: "1 hr", detail: "Allow custom header x-llm-observer-tags: ['production','chat-feature'] to tag requests for filtering in dashboard." },
            { task: "Add daily_stats aggregation", time: "1 hr", detail: "Cron job (or on-write trigger) that aggregates requests into daily_stats table. Dashboard reads from this for fast chart queries." },
            { task: "Week 1 integration test", time: "1.5 hr", detail: "Send 50 mixed requests (OpenAI, Claude, Gemini, streaming, errors) through proxy. Verify all logged correctly with accurate costs." },
          ],
          totalHours: "8 hrs",
        },
      ],
    },
    {
      week: 2,
      title: "Dashboard + CLI Interface",
      goal: "Beautiful real-time dashboard in the browser. Full CLI with all commands. Developer can see everything happening with their LLM calls.",
      outcome: "Open localhost:4001 and see real-time spend, charts, request logs. Run llm-observer commands in terminal.",
      days: [
        {
          day: "Day 1",
          title: "Dashboard — Overview Page",
          color: C.blue,
          tasks: [
            { task: "Set up React + Vite + Tailwind in packages/dashboard", time: "30 min", detail: "Standard Vite React-TS template. Tailwind for styling. Dark theme by default." },
            { task: "Build dashboard API server", time: "1.5 hr", detail: "Express server on port 4001. Serves React build + /api/* endpoints. GET /api/stats/overview, GET /api/stats/timeline" },
            { task: "Build SpendCounter component", time: "1.5 hr", detail: "Large animated counter showing today's total spend. Updates in real-time via SSE. Green when under budget, yellow at 80%, red when exceeded." },
            { task: "Build Overview page layout", time: "2 hr", detail: "4 stat cards (Today's Spend, Total Requests, Avg Latency, Error Rate) + cost timeline chart + model breakdown pie chart." },
            { task: "Build CostChart component (recharts)", time: "1.5 hr", detail: "Line chart showing spend over time. Toggle between hourly (today) and daily (this week/month) views." },
            { task: "Build ModelBreakdown component", time: "1 hr", detail: "Horizontal bar chart or pie chart showing cost split by model. Click a model to filter." },
          ],
          totalHours: "8 hrs",
        },
        {
          day: "Day 2",
          title: "Dashboard — Request Log + Detail View",
          color: C.blue,
          tasks: [
            { task: "Build RequestTable component", time: "2.5 hr", detail: "Sortable table: timestamp, provider, model, tokens, cost, latency, status. Pagination. Filters: by provider, model, status, date range, min cost." },
            { task: "Build RequestDetail page", time: "2 hr", detail: "Click any request → full detail view. Show: complete prompt, complete response, token breakdown, cost calculation, latency, headers. Syntax highlighting for JSON." },
            { task: "Add search functionality", time: "1 hr", detail: "Full-text search across request/response bodies. Debounced input. Highlight matches." },
            { task: "Build real-time SSE connection", time: "1.5 hr", detail: "hooks/useSSE.ts — Connect to GET /api/events. On new request event → update overview stats, prepend to request table, animate new row." },
            { task: "Polish table UX", time: "1 hr", detail: "Color-code by provider (green=OpenAI, orange=Anthropic, blue=Google). Red highlight for errors. Yellow for slow requests." },
          ],
          totalHours: "8 hrs",
        },
        {
          day: "Day 3",
          title: "Dashboard — Projects + Budget + Alerts",
          color: C.orange,
          tasks: [
            { task: "Build Projects page", time: "2 hr", detail: "List projects with current spend vs budget. Create new project form. Edit budget settings. Show project API key (copyable)." },
            { task: "Build BudgetMeter component", time: "1 hr", detail: "Visual gauge showing spend vs limit. Animated fill. Color transitions: green → yellow → red. Pulse animation when near limit." },
            { task: "Build Alerts page", time: "1.5 hr", detail: "List all alerts with type, severity, timestamp. Mark as acknowledged. Filter by type (budget, anomaly, error)." },
            { task: "Build Settings page", time: "1.5 hr", detail: "Configure: proxy port, dashboard port, webhook URL, notification preferences, data retention period." },
            { task: "Add navigation + routing", time: "1 hr", detail: "Sidebar nav: Overview, Requests, Projects, Alerts, Settings. React Router. Active state highlighting." },
            { task: "Add responsive design", time: "1 hr", detail: "Dashboard should work on different screen sizes. Collapsible sidebar on smaller screens." },
          ],
          totalHours: "8 hrs",
        },
        {
          day: "Day 4",
          title: "CLI Interface",
          color: C.purple,
          tasks: [
            { task: "Set up Commander.js in packages/cli", time: "1 hr", detail: "Entry point with all subcommands registered. Help text. Version flag." },
            { task: "Build 'start' command", time: "2 hr", detail: "Start proxy + dashboard servers. Show startup banner with ports, active project, budget. Keep running in foreground with live request log." },
            { task: "Build 'status' command", time: "45 min", detail: "Show: running/stopped, ports, today's spend, active project, last request timestamp." },
            { task: "Build 'stats' command", time: "1 hr", detail: "Terminal table: today/week/month spend broken down by model. Colored output with chalk." },
            { task: "Build 'logs' command", time: "1 hr", detail: "Live tail of requests like 'tail -f'. Show: timestamp, provider, model, tokens, cost, latency. Filter flags: --provider, --model, --min-cost." },
            { task: "Build 'projects' commands", time: "1.5 hr", detail: "projects list, projects create (interactive prompts via inquirer), projects delete." },
            { task: "Build 'budget' + 'config' + 'export' commands", time: "1.5 hr", detail: "budget set <amount> --daily/weekly/monthly. config view/set. export --format csv/json --range 7d/30d/all." },
          ],
          totalHours: "8.75 hrs",
        },
        {
          day: "Day 5",
          title: "Integration + Polish",
          color: C.cyan,
          tasks: [
            { task: "Wire CLI to start proxy + dashboard together", time: "1.5 hr", detail: "'llm-observer start' spawns both servers. Graceful shutdown on Ctrl+C. PID file to prevent double-start." },
            { task: "Add 'npx llm-observer start' quick-start support", time: "1 hr", detail: "Configure package.json bin field. Test npx execution without global install." },
            { task: "Build anomaly detection", time: "2 hr", detail: "anomaly-detector.ts — Track rolling average cost/hour. If current hour > 5x average → trigger 'anomaly' alert. Simple but effective." },
            { task: "End-to-end testing", time: "2 hr", detail: "Full flow: install via npm, start, send requests from a test app, verify dashboard shows correct data, verify alerts fire, verify budget kill switch, verify CLI commands all work." },
            { task: "Fix bugs + polish terminal output", time: "1.5 hr", detail: "Colored output, spinners (ora), clean error messages, helpful suggestions on common issues." },
          ],
          totalHours: "8 hrs",
        },
      ],
    },
    {
      week: 3,
      title: "Launch Preparation + Ship It",
      goal: "Package everything. Write docs. Publish to npm. Launch publicly. Get first 100 users.",
      outcome: "Live on npm. Product Hunt ready. First developers using it.",
      days: [
        {
          day: "Day 1",
          title: "Documentation (THIS IS YOUR MARKETING)",
          color: C.yellow,
          tasks: [
            { task: "Write README.md — this is your landing page", time: "3 hr", detail: "Hero section with GIF demo. One-line install. Quick start (3 steps). Feature list with screenshots. Comparison table vs competitors. Pricing. Architecture diagram. FAQ. Contributing guide." },
            { task: "Create demo GIF / video", time: "2 hr", detail: "Screen record: install → start → send requests → show dashboard updating in real-time → budget alert firing. Convert to GIF for README. 30-second version for social media." },
            { task: "Write docs site (optional but impressive)", time: "2 hr", detail: "Simple Docusaurus or VitePress site. Pages: Getting Started, Configuration, Providers, Budget Alerts, CLI Reference, Dashboard Guide, FAQ." },
            { task: "Add inline --help text for all CLI commands", time: "1 hr", detail: "Every command should have clear help text with examples." },
          ],
          totalHours: "8 hrs",
        },
        {
          day: "Day 2",
          title: "Packaging + npm Publish",
          color: C.green,
          tasks: [
            { task: "Configure package.json for npm publish", time: "1 hr", detail: "name: 'llm-observer', bin field, files field (only include dist/), keywords, repository, license (MIT)." },
            { task: "Build + bundle all packages", time: "1.5 hr", detail: "TypeScript compile all packages. Bundle CLI entry point. Verify 'npm pack' produces clean tarball." },
            { task: "Test fresh install on clean machine", time: "1.5 hr", detail: "Use a Docker container or VM. npm install -g llm-observer. Run through full flow. Fix any missing dependencies or path issues." },
            { task: "Publish to npm", time: "30 min", detail: "npm publish. Verify: npm install -g llm-observer && llm-observer --version works." },
            { task: "Set up GitHub repo properly", time: "1.5 hr", detail: "Clean repo with LICENSE, CONTRIBUTING.md, issue templates, GitHub Actions CI (lint + test on PR)." },
            { task: "Create landing page", time: "2 hr", detail: "Simple one-page site on Vercel. Hero with demo GIF, features, install command, link to GitHub. Can be a simple React page or even plain HTML." },
          ],
          totalHours: "8 hrs",
        },
        {
          day: "Day 3",
          title: "Billing + License System",
          color: C.orange,
          tasks: [
            { task: "Build minimal license server", time: "3 hr", detail: "Tiny Express app on Render. POST /api/activate (validate license key → return plan). GET /api/verify (check if key is still valid). Store keys in MongoDB Atlas free tier or even a JSON file to start." },
            { task: "Integrate license check in CLI", time: "1.5 hr", detail: "On 'llm-observer start': check ~/.llm-observer/config.json for license_key. If none → run in free mode (7-day retention, 1 project). If key exists → verify with server → unlock Pro features." },
            { task: "Set up Stripe or Razorpay", time: "1.5 hr", detail: "Create Pro ($19/mo) and Team ($49/mo) products. Generate license keys on successful payment. Send key via email." },
            { task: "Build upgrade flow", time: "1 hr", detail: "'llm-observer upgrade' → opens pricing page in browser. After payment → 'llm-observer activate <key>' → unlocks Pro features." },
            { task: "Implement free tier limits", time: "1 hr", detail: "Free: 1 project, 7-day log retention. Auto-purge old logs via scheduled cleanup function." },
          ],
          totalHours: "8 hrs",
        },
        {
          day: "Day 4-5",
          title: "LAUNCH WEEK",
          color: C.red,
          tasks: [
            { task: "Prepare Product Hunt launch", time: "2 hr", detail: "Create maker profile. Write tagline, description, first comment. Schedule screenshots and demo GIF. Line up 5-10 friends to upvote early." },
            { task: "Write HackerNews Show HN post", time: "1 hr", detail: "Title: 'Show HN: LLM Observer – Track your AI API costs locally (data never leaves your machine)'. Write honest 3-paragraph description focusing on privacy-first angle." },
            { task: "Write launch tweets/posts", time: "1.5 hr", detail: "Thread for Twitter/X: Problem → Solution → Demo GIF → Architecture → How it works → Link. LinkedIn post version. Reddit posts for r/programming, r/artificial, r/SaaS." },
            { task: "Post to dev communities", time: "1.5 hr", detail: "Dev.to article: 'How I built a local-first LLM cost tracker'. Hashnode cross-post. Indie Hackers product listing." },
            { task: "LAUNCH DAY: Post everywhere", time: "2 hr", detail: "Product Hunt at midnight PST. HackerNews at 8 AM EST. Twitter thread at 9 AM EST. LinkedIn at 10 AM. Reddit at 11 AM. Dev.to at noon." },
            { task: "Monitor + respond to feedback", time: "4 hr", detail: "Reply to every comment, every GitHub issue, every tweet. First day feedback is GOLD. Fix any critical bugs immediately. Ship patch same day if needed." },
            { task: "Send personal DMs to dev influencers", time: "2 hr", detail: "Find 20 developers on Twitter who've complained about LLM costs. DM them a personal message + link. Not spammy — genuine and helpful." },
          ],
          totalHours: "14 hrs (over 2 days)",
        },
      ],
    },
  ],
};

// ── PHASE 2: TAURI (Weeks 4-5) ──
const phase2 = {
  title: "PHASE 2: TAURI DESKTOP APP",
  subtitle: "Wrap the working CLI in a native desktop app. 5MB, zero RAM overhead.",
  color: C.purple,
  weeks: [
    {
      week: 4,
      title: "Tauri Shell + Sidecar",
      goal: "Working desktop app that bundles your CLI proxy as a sidecar. System tray, native notifications, auto-start.",
      outcome: "Downloadable .dmg / .msi / .AppImage that 'just works' — install and forget.",
      days: [
        {
          day: "Day 1-2",
          title: "Tauri Setup + Sidecar Configuration",
          color: C.purple,
          tasks: [
            { task: "Install Rust + Tauri CLI", time: "1 hr", detail: "Install rustup, cargo, then: cargo install tauri-cli. Verify: cargo tauri --version" },
            { task: "Initialize Tauri in apps/tauri/", time: "1.5 hr", detail: "cargo tauri init. Point webview source to packages/dashboard build output. Configure window size, title, icon." },
            { task: "Bundle Node.js proxy as sidecar", time: "3 hr", detail: "Use 'pkg' to compile packages/proxy + packages/cli into a single binary. Configure tauri.conf.json to include it as a sidecar. Write Rust code in main.rs to spawn sidecar on app start." },
            { task: "Handle sidecar lifecycle", time: "2 hr", detail: "Start sidecar when app opens. Monitor health. Restart if crashed. Kill on app quit. Handle port conflicts." },
            { task: "Configure Tauri permissions", time: "1 hr", detail: "Allow: localhost network access, notifications, autostart, shell commands. Deny: everything else (minimize attack surface)." },
            { task: "Test: app launches, proxy starts, dashboard loads", time: "1.5 hr", detail: "Verify complete flow works inside Tauri. React dashboard renders in native webview. Proxy accepts requests. Data flows correctly." },
          ],
          totalHours: "10 hrs",
        },
        {
          day: "Day 3-4",
          title: "Native Features",
          color: C.cyan,
          tasks: [
            { task: "Add system tray", time: "2.5 hr", detail: "Tray icon with status indicator. Green = proxy running. Red = stopped. Grey = error. Right-click menu: Open Dashboard, Start/Stop Proxy, Today's Spend, Quit." },
            { task: "Add native OS notifications", time: "1.5 hr", detail: "Replace node-notifier with Tauri's notification plugin. Budget warnings, anomaly alerts, error spikes — all as native notifications." },
            { task: "Add auto-start on login", time: "1 hr", detail: "tauri-plugin-autostart — app launches on system boot. Proxy starts silently in background. Developer never thinks about it." },
            { task: "Add auto-updater", time: "2 hr", detail: "tauri-plugin-updater — check GitHub Releases for new versions. Download and install silently. Show 'Update available' in tray menu." },
            { task: "Add 'minimize to tray' behavior", time: "1 hr", detail: "Closing window minimizes to tray instead of quitting. Proxy keeps running. Click tray icon to reopen dashboard." },
            { task: "Test on all platforms", time: "2 hr", detail: "Build for Mac (.dmg), Windows (.msi), Linux (.AppImage). Test basic flow on each. Fix platform-specific issues." },
          ],
          totalHours: "10 hrs",
        },
        {
          day: "Day 5",
          title: "Package + Distribute",
          color: C.orange,
          tasks: [
            { task: "Configure app icons for all platforms", time: "1 hr", detail: "1024x1024 icon. Tauri generates all sizes. macOS .icns, Windows .ico, Linux .png." },
            { task: "Set up GitHub Releases CI", time: "2 hr", detail: "GitHub Action: on tag push → cargo tauri build for Mac/Windows/Linux → upload artifacts to GitHub Release. Auto-generates download links." },
            { task: "Create download page on landing site", time: "1.5 hr", detail: "Detect OS → show correct download button. Mac / Windows / Linux. Show app size (5MB!) prominently." },
            { task: "Write desktop app documentation", time: "1.5 hr", detail: "Installation guide. How it differs from CLI. System tray usage. Auto-start configuration." },
            { task: "Launch desktop version", time: "2 hr", detail: "Update Product Hunt page. New HackerNews post. Twitter announcement. 'LLM Observer now has a 5MB desktop app.'" },
          ],
          totalHours: "8 hrs",
        },
      ],
    },
  ],
};

// ── PHASE 3: GROWTH (Weeks 6-8) ──
const phase3 = {
  title: "PHASE 3: GROWTH + MONETIZATION",
  subtitle: "Add features users are asking for. Grow to 500+ users. First $1K revenue.",
  color: C.orange,
  weeks: [
    {
      week: "6-8",
      title: "Feature Expansion + Revenue",
      goal: "Based on user feedback, add the most requested features. Convert free users to paid. Reach $1K MRR.",
      outcome: "Established product with paying customers and growing community.",
      days: [
        {
          day: "Week 6",
          title: "Most-Requested Features",
          color: C.blue,
          tasks: [
            { task: "Cost optimizer suggestions", time: "8 hr", detail: "'You sent 340 requests to GPT-4o under 100 tokens. Switching to GPT-4o-mini saves $47/month.' Analyze request patterns → suggest cheaper models." },
            { task: "Prompt caching / dedup detection", time: "6 hr", detail: "Hash prompts. Show: 'You sent this exact prompt 23 times today — consider caching.' Dashboard page showing duplicate detection." },
            { task: "Export to CSV/PDF reports", time: "4 hr", detail: "Weekly/monthly cost reports. Useful for freelancers billing clients. PDF with charts and breakdown." },
            { task: "Custom dashboards / saved filters", time: "6 hr", detail: "Let users save filter presets: 'Production only', 'Expensive requests (>$0.01)', 'Errors this week'." },
          ],
          totalHours: "24 hrs",
        },
        {
          day: "Week 7",
          title: "Team Features (Paid Tier Unlock)",
          color: C.purple,
          tasks: [
            { task: "Team sync — encrypted cloud aggregation", time: "12 hr", detail: "Opt-in: team members' local stats sync (encrypted) to a shared dashboard. Team lead sees aggregated spend across all developers. E2E encryption — you can't read their data." },
            { task: "Role-based access", time: "4 hr", detail: "Admin (full access), Developer (own stats only), Viewer (read-only aggregated). Managed via license keys." },
            { task: "Team billing integration", time: "4 hr", detail: "Team plan: $49/month for up to 10 seats. Per-seat billing beyond that. Stripe/Razorpay integration." },
            { task: "Audit logs", time: "4 hr", detail: "Who changed budget settings? Who activated/deactivated kill switch? Important for team accountability." },
          ],
          totalHours: "24 hrs",
        },
        {
          day: "Week 8",
          title: "Growth + Marketing Push",
          color: C.yellow,
          tasks: [
            { task: "Write 3 SEO blog posts", time: "6 hr", detail: "'How to reduce OpenAI API costs by 60%', 'Claude vs GPT-4o: Real cost comparison with data', 'Stop burning money on LLM APIs — a developer's guide'" },
            { task: "Create comparison pages", time: "4 hr", detail: "LLM Observer vs Helicone, vs Portkey, vs LangSmith. Honest comparisons. Highlight privacy-first angle." },
            { task: "GitHub sponsorship + open source growth", time: "4 hr", detail: "Add GitHub Sponsors. Respond to all issues within 24hrs. Accept community PRs. Build contributor community." },
            { task: "Reach out to dev podcasts / newsletters", time: "4 hr", detail: "Email 10 dev newsletters (TLDR, Bytes, JavaScript Weekly). Pitch for feature/mention. Offer exclusive discount codes." },
            { task: "Analyze metrics + plan next quarter", time: "6 hr", detail: "Review: total users, DAU, conversion rate, MRR, churn, most-used features, top feature requests. Plan Q2 roadmap." },
          ],
          totalHours: "24 hrs",
        },
      ],
    },
  ],
};

function DayCard({ day, expanded, onToggle }) {
  return (
    <div style={{
      background: C.bgCard, borderRadius: 10,
      border: `1px solid ${day.color}18`, overflow: "hidden",
      marginBottom: 6,
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: "11px 16px", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: expanded ? `1px solid ${day.color}12` : "none",
          transition: "background 0.15s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            color: day.color, fontFamily: mono, fontSize: 11, fontWeight: 700,
            background: `${day.color}15`, padding: "3px 8px", borderRadius: 4,
            minWidth: 50, textAlign: "center",
          }}>{day.day}</span>
          <span style={{ color: C.textBright, fontSize: 14, fontWeight: 600, fontFamily: sans }}>{day.title}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: C.textDim, fontSize: 11, fontFamily: mono }}>{day.totalHours}</span>
          <span style={{ color: day.color, fontSize: 14 }}>{expanded ? "▼" : "▶"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "4px 0" }}>
          {day.tasks.map((t, i) => (
            <div key={i} style={{
              padding: "10px 16px 10px 78px",
              borderBottom: i < day.tasks.length - 1 ? `1px solid ${C.border}60` : "none",
              position: "relative",
            }}>
              {t.time && (
                <span style={{
                  position: "absolute", left: 16,
                  color: C.textDim, fontSize: 10, fontFamily: mono,
                  background: `${C.textDim}10`, padding: "2px 6px", borderRadius: 3,
                  top: 12,
                }}>{t.time}</span>
              )}
              <div style={{ color: C.textBright, fontSize: 13, fontWeight: 600, fontFamily: sans }}>{t.task}</div>
              <div style={{ color: C.textDim, fontSize: 12, fontFamily: mono, marginTop: 4, lineHeight: 1.6 }}>{t.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PhaseSection({ phase }) {
  const [expandedDays, setExpandedDays] = useState({});
  const [expandedWeeks, setExpandedWeeks] = useState(
    Object.fromEntries(phase.weeks.map(w => [w.week, true]))
  );

  const toggleDay = (weekIdx, dayIdx) => {
    const key = `${weekIdx}-${dayIdx}`;
    setExpandedDays(p => ({ ...p, [key]: !p[key] }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Phase Header */}
      <div style={{
        background: `${phase.color}08`, borderRadius: 12, padding: "18px 22px",
        border: `1.5px solid ${phase.color}30`,
      }}>
        <div style={{ color: phase.color, fontSize: 15, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5 }}>
          {phase.title}
        </div>
        <div style={{ color: C.text, fontSize: 13, fontFamily: sans, marginTop: 6 }}>{phase.subtitle}</div>
      </div>

      {/* Weeks */}
      {phase.weeks.map((week, wi) => (
        <div key={wi} style={{
          background: `${C.bg}`, borderRadius: 12,
          border: `1px solid ${C.border}`, overflow: "hidden",
        }}>
          <div
            onClick={() => setExpandedWeeks(p => ({ ...p, [week.week]: !p[week.week] }))}
            style={{
              padding: "14px 20px", cursor: "pointer",
              borderBottom: expandedWeeks[week.week] ? `1px solid ${C.border}` : "none",
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  color: C.bg, background: phase.color, padding: "3px 10px",
                  borderRadius: 6, fontSize: 12, fontWeight: 800, fontFamily: mono,
                }}>WEEK {week.week}</span>
                <span style={{ color: C.textBright, fontSize: 16, fontWeight: 700, fontFamily: sans }}>{week.title}</span>
              </div>
              <div style={{ color: C.textDim, fontSize: 12, fontFamily: sans, marginTop: 6, maxWidth: 600 }}>
                <strong style={{ color: C.text }}>Goal:</strong> {week.goal}
              </div>
              <div style={{ color: phase.color, fontSize: 12, fontFamily: mono, marginTop: 4 }}>
                ✓ Outcome: {week.outcome}
              </div>
            </div>
            <span style={{ color: phase.color, fontSize: 16, marginTop: 4 }}>
              {expandedWeeks[week.week] ? "▼" : "▶"}
            </span>
          </div>
          {expandedWeeks[week.week] && (
            <div style={{ padding: "12px 16px" }}>
              {week.days.map((day, di) => (
                <DayCard
                  key={di}
                  day={day}
                  expanded={expandedDays[`${wi}-${di}`]}
                  onToggle={() => toggleDay(wi, di)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Timeline() {
  const milestones = [
    { week: "W1", label: "Proxy engine working", color: C.green, done: false },
    { week: "W2", label: "Dashboard + CLI ready", color: C.blue, done: false },
    { week: "W3", label: "npm published + LAUNCH", color: C.yellow, done: false },
    { week: "W4", label: "Tauri desktop app shipped", color: C.purple, done: false },
    { week: "W6", label: "Cost optimizer + caching", color: C.orange, done: false },
    { week: "W7", label: "Team features live", color: C.cyan, done: false },
    { week: "W8", label: "Target: $1K MRR", color: C.red, done: false },
  ];

  return (
    <div style={{
      background: C.bgCard, borderRadius: 12, padding: "18px 22px",
      border: `1px solid ${C.border}`, marginBottom: 20,
    }}>
      <div style={{ color: C.textDim, fontSize: 12, fontFamily: mono, fontWeight: 700, letterSpacing: 1.5, marginBottom: 14 }}>
        8-WEEK MILESTONE TIMELINE
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 0, position: "relative" }}>
        {milestones.map((m, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
            {/* Line */}
            {i < milestones.length - 1 && (
              <div style={{
                position: "absolute", top: 10, left: "50%", right: "-50%",
                height: 2, background: `${m.color}40`,
                zIndex: 0,
              }} />
            )}
            {/* Dot */}
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: `${m.color}25`, border: `2px solid ${m.color}`,
              zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: m.color }} />
            </div>
            <div style={{ color: m.color, fontSize: 11, fontWeight: 700, fontFamily: mono, marginTop: 6 }}>{m.week}</div>
            <div style={{ color: C.textDim, fontSize: 10, fontFamily: mono, textAlign: "center", marginTop: 2, maxWidth: 80 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [activePhase, setActivePhase] = useState("phase1");

  const phases = [
    { id: "phase1", label: "Phase 1: CLI (W1-3)", data: phase1 },
    { id: "phase2", label: "Phase 2: Tauri (W4-5)", data: phase2 },
    { id: "phase3", label: "Phase 3: Growth (W6-8)", data: phase3 },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: sans }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ padding: "20px 24px 0", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.green}, #1a6b44)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: `0 0 20px rgba(61,255,160,0.15)`,
          }}>⬡</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.textBright, fontFamily: mono, letterSpacing: -0.5 }}>
              LLM Observer — Build Plan
            </div>
            <div style={{ fontSize: 12, color: C.textDim, fontFamily: mono }}>
              8 weeks from zero to $1K MRR · Day-by-day task breakdown
            </div>
          </div>
        </div>

        {/* Phase Tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {phases.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePhase(p.id)}
              style={{
                padding: "10px 18px",
                background: activePhase === p.id ? "#0f1822" : "transparent",
                border: "none",
                borderBottom: activePhase === p.id ? `2px solid ${p.data.color}` : "2px solid transparent",
                color: activePhase === p.id ? p.data.color : C.textDim,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: mono, borderRadius: "6px 6px 0 0",
                transition: "all 0.15s",
              }}
            >{p.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
        <Timeline />
        <PhaseSection phase={phases.find(p => p.id === activePhase).data} />
      </div>
    </div>
  );
}
