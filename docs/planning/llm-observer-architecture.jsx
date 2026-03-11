import { useState, useEffect } from "react";

// ── Aesthetic: Terminal/hacker dark theme with green phosphor accents ──
// Inspired by old CRT monitors meets modern dev tooling

const C = {
  bg: "#04090f",
  bgCard: "#0a1018",
  bgHover: "#0f1822",
  border: "#14222e",
  borderFocus: "#1a3a28",
  text: "#c0d0dc",
  textDim: "#4a6272",
  textBright: "#eaf2f8",
  green: "#3dffa0",
  greenDim: "#1a6b44",
  greenGlow: "0 0 20px rgba(61,255,160,0.15)",
  blue: "#4ac8ff",
  blueDim: "#1a4a6b",
  orange: "#ffa347",
  orangeDim: "#6b4a1a",
  red: "#ff5a5a",
  redDim: "#6b1a1a",
  purple: "#b88aff",
  purpleDim: "#3a1a6b",
  cyan: "#4affea",
  cyanDim: "#1a5a4a",
  yellow: "#ffe24a",
  yellowDim: "#5a4a1a",
};

const mono = "'IBM Plex Mono', 'Fira Code', monospace";
const sans = "'IBM Plex Sans', -apple-system, sans-serif";

const tabs = [
  { id: "overview", label: "Overview", icon: "◎" },
  { id: "arch", label: "Architecture", icon: "⬡" },
  { id: "data-flow", label: "Data Flow", icon: "⇶" },
  { id: "db", label: "Database", icon: "⊞" },
  { id: "api", label: "API Surface", icon: "⌁" },
  { id: "cli", label: "CLI Design", icon: "▶" },
  { id: "tauri", label: "Tauri Migration", icon: "◆" },
  { id: "folder", label: "Project Structure", icon: "⊟" },
];

// ════════════════════════════════════════
// OVERVIEW TAB
// ════════════════════════════════════════
function Overview() {
  const stack = [
    { layer: "PHASE 1: CLI", items: [
      { name: "Proxy Engine", tech: "Node.js + http-proxy", color: C.green },
      { name: "Dashboard", tech: "React + Vite (browser)", color: C.blue },
      { name: "Local DB", tech: "SQLite via better-sqlite3", color: C.cyan },
      { name: "CLI Interface", tech: "Commander.js + Chalk", color: C.purple },
      { name: "Token Counter", tech: "tiktoken / custom", color: C.orange },
      { name: "Alerts", tech: "node-notifier + webhooks", color: C.red },
    ]},
    { layer: "PHASE 2: TAURI DESKTOP", items: [
      { name: "App Shell", tech: "Tauri v2 (Rust + native webview)", color: C.green },
      { name: "Dashboard", tech: "Same React app (zero rewrite)", color: C.blue },
      { name: "Proxy Engine", tech: "Node.js sidecar → Rust migration", color: C.cyan },
      { name: "System Tray", tech: "Tauri tray API (native)", color: C.purple },
      { name: "Notifications", tech: "Native OS notifications", color: C.orange },
      { name: "Auto-Update", tech: "Tauri updater (built-in)", color: C.red },
    ]},
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Core Principle */}
      <div style={{
        background: `linear-gradient(135deg, ${C.greenDim}40, ${C.bg})`,
        borderRadius: 12, padding: "20px 24px",
        border: `1px solid ${C.greenDim}`,
        boxShadow: C.greenGlow,
      }}>
        <div style={{ color: C.green, fontSize: 13, fontFamily: mono, fontWeight: 700, marginBottom: 8, letterSpacing: 2 }}>
          CORE PRINCIPLE
        </div>
        <div style={{ color: C.textBright, fontSize: 17, lineHeight: 1.6, fontFamily: sans }}>
          Everything runs on the developer's machine. API keys never leave localhost. Prompts never touch external servers. The app is an invisible, lightweight observer — not a middleman.
        </div>
      </div>

      {/* Phase Stack */}
      {stack.map((phase, pi) => (
        <div key={pi} style={{
          background: C.bgCard, borderRadius: 12,
          border: `1px solid ${C.border}`, overflow: "hidden",
        }}>
          <div style={{
            padding: "12px 20px",
            borderBottom: `1px solid ${C.border}`,
            color: pi === 0 ? C.green : C.purple,
            fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5,
          }}>
            {phase.layer}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: C.border }}>
            {phase.items.map((item, i) => (
              <div key={i} style={{ background: C.bgCard, padding: "14px 18px" }}>
                <div style={{ color: item.color, fontSize: 13, fontWeight: 700, fontFamily: mono }}>{item.name}</div>
                <div style={{ color: C.textDim, fontSize: 12, marginTop: 4, fontFamily: mono }}>{item.tech}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Cost Breakdown */}
      <div style={{
        background: C.bgCard, borderRadius: 12, padding: 20,
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ color: C.green, fontSize: 13, fontFamily: mono, fontWeight: 700, marginBottom: 14, letterSpacing: 1.5 }}>
          INFRASTRUCTURE COST
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            { item: "Proxy server", cost: "₹0", note: "Runs locally" },
            { item: "Database", cost: "₹0", note: "SQLite file on disk" },
            { item: "Dashboard", cost: "₹0", note: "localhost in browser/Tauri" },
            { item: "License server", cost: "~₹500/mo", note: "Tiny API on Render" },
            { item: "npm registry", cost: "₹0", note: "Free to publish" },
            { item: "Landing page", cost: "₹0", note: "Vercel free tier" },
          ].map((c, i) => (
            <div key={i} style={{
              background: `${C.green}08`, borderRadius: 8,
              padding: "10px 14px", border: `1px solid ${C.green}15`,
              minWidth: 160, flex: "1 1 160px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: C.text, fontSize: 12, fontFamily: mono }}>{c.item}</span>
                <span style={{ color: C.green, fontWeight: 700, fontSize: 14, fontFamily: mono }}>{c.cost}</span>
              </div>
              <div style={{ color: C.textDim, fontSize: 11, marginTop: 4, fontFamily: mono }}>{c.note}</div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 14, padding: "10px 16px",
          background: `${C.green}12`, borderRadius: 8,
          display: "inline-block", border: `1px solid ${C.green}25`,
        }}>
          <span style={{ color: C.green, fontWeight: 800, fontSize: 18, fontFamily: mono }}>
            Total: ~₹500/month
          </span>
          <span style={{ color: C.textDim, fontSize: 12, marginLeft: 12, fontFamily: mono }}>
            (only the license server)
          </span>
        </div>
      </div>

      {/* Supported Providers */}
      <div style={{ background: C.bgCard, borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.blue, fontSize: 13, fontFamily: mono, fontWeight: 700, marginBottom: 14, letterSpacing: 1.5 }}>
          SUPPORTED LLM PROVIDERS (MVP)
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { name: "OpenAI", models: "GPT-4o, GPT-4o-mini, o1, o3", color: C.green },
            { name: "Anthropic", models: "Claude Opus, Sonnet, Haiku", color: C.orange },
            { name: "Google", models: "Gemini 2.5 Pro, Flash", color: C.blue },
            { name: "Mistral", models: "Large, Medium, Small", color: C.purple },
            { name: "Groq", models: "Llama, Mixtral (fast)", color: C.red },
            { name: "Custom/Local", models: "Ollama, vLLM, any OpenAI-compatible", color: C.cyan },
          ].map((p, i) => (
            <div key={i} style={{
              background: `${p.color}08`, borderRadius: 8, padding: "10px 16px",
              border: `1px solid ${p.color}20`, flex: "1 1 200px",
            }}>
              <div style={{ color: p.color, fontWeight: 700, fontSize: 14, fontFamily: mono }}>{p.name}</div>
              <div style={{ color: C.textDim, fontSize: 11, marginTop: 4, fontFamily: mono }}>{p.models}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// ARCHITECTURE DIAGRAM
// ════════════════════════════════════════
function ArchDiagram() {
  const Box = ({ children, color, dashed, style: s = {} }) => (
    <div style={{
      background: `${color}0a`, borderRadius: 10,
      padding: "14px 18px",
      border: `${dashed ? "1.5px dashed" : "1.5px solid"} ${color}40`,
      ...s,
    }}>{children}</div>
  );
  const Label = ({ children, color }) => (
    <div style={{ color, fontSize: 12, fontWeight: 700, fontFamily: mono, letterSpacing: 1 }}>{children}</div>
  );
  const Sub = ({ children }) => (
    <div style={{ color: C.textDim, fontSize: 11, fontFamily: mono, marginTop: 4 }}>{children}</div>
  );
  const Arrow = ({ label, color = C.textDim }) => (
    <div style={{ textAlign: "center", padding: "6px 0", color, fontSize: 11, fontFamily: mono }}>
      │ {label && <span style={{ color: C.text, background: C.bgCard, padding: "1px 6px", borderRadius: 4 }}>{label}</span>}
      <br />▼
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Machine boundary */}
      <div style={{
        border: `2px solid ${C.green}30`, borderRadius: 16, padding: 20,
        background: `${C.green}03`,
        position: "relative",
      }}>
        <div style={{
          position: "absolute", top: -11, left: 20,
          background: C.bg, padding: "0 10px",
          color: C.green, fontSize: 12, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5,
        }}>
          DEVELOPER'S MACHINE — NOTHING LEAVES THIS BOUNDARY
        </div>

        {/* Developer's App */}
        <Box color={C.blue}>
          <Label color={C.blue}>DEVELOPER'S AI APPLICATION</Label>
          <Sub>Their app that calls LLM APIs — only change: base URL → localhost:4000</Sub>
        </Box>

        <Arrow label="HTTP request to localhost:4000" />

        {/* Proxy Engine */}
        <Box color={C.green} style={{ boxShadow: C.greenGlow }}>
          <Label color={C.green}>⬡ LOCAL PROXY ENGINE (localhost:4000)</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            {[
              { step: "① Intercept", desc: "Capture incoming request" },
              { step: "② Authenticate", desc: "Validate local project key" },
              { step: "③ Check Budget", desc: "Compare spend vs daily limit" },
              { step: "④ Forward", desc: "Send to real LLM provider" },
              { step: "⑤ Capture Response", desc: "Log tokens, latency, cost" },
              { step: "⑥ Async Log", desc: "Write to SQLite (non-blocking)" },
            ].map((s, i) => (
              <div key={i} style={{ background: `${C.green}10`, borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ color: C.green, fontSize: 11, fontWeight: 700, fontFamily: mono }}>{s.step}</div>
                <div style={{ color: C.textDim, fontSize: 10, fontFamily: mono, marginTop: 2 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </Box>

        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          {/* Left: DB */}
          <div style={{ flex: 1 }}>
            <Arrow label="async write" color={C.cyan} />
            <Box color={C.cyan}>
              <Label color={C.cyan}>⊞ SQLITE DATABASE</Label>
              <Sub>~/.llm-observer/data.db</Sub>
              <Sub>requests, costs, projects, alerts</Sub>
              <Sub>Single file. Zero setup. Portable.</Sub>
            </Box>
          </div>
          {/* Right: Dashboard */}
          <div style={{ flex: 1 }}>
            <Arrow label="serves UI" color={C.blue} />
            <Box color={C.blue}>
              <Label color={C.blue}>◎ DASHBOARD (localhost:4001)</Label>
              <Sub>React app — runs in browser (Phase 1)</Sub>
              <Sub>or inside Tauri webview (Phase 2)</Sub>
              <Sub>Real-time charts, logs, alerts, budgets</Sub>
            </Box>
          </div>
        </div>

        {/* Alert Engine */}
        <div style={{ marginTop: 12 }}>
          <Box color={C.red}>
            <Label color={C.red}>🚨 ALERT ENGINE (runs inside proxy)</Label>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {[
                "Budget 80% warning → OS notification",
                "Budget 100% → KILL SWITCH (block all requests)",
                "Spend spike detected → Slack/Discord webhook",
                "Error rate > 10% → OS notification",
                "Latency anomaly → Dashboard warning",
              ].map((a, i) => (
                <div key={i} style={{
                  background: `${C.red}10`, borderRadius: 6, padding: "6px 10px",
                  color: C.text, fontSize: 11, fontFamily: mono, border: `1px solid ${C.red}15`,
                }}>
                  {a}
                </div>
              ))}
            </div>
          </Box>
        </div>
      </div>

      {/* External calls */}
      <Arrow label="HTTPS — direct to provider (your proxy just forwards)" color={C.orange} />

      <div style={{ display: "flex", gap: 10 }}>
        {[
          { name: "OpenAI API", color: C.green },
          { name: "Claude API", color: C.orange },
          { name: "Gemini API", color: C.blue },
          { name: "Mistral API", color: C.purple },
          { name: "Groq API", color: C.red },
        ].map((p, i) => (
          <Box key={i} color={p.color} style={{ flex: 1, textAlign: "center" }}>
            <Label color={p.color}>{p.name}</Label>
          </Box>
        ))}
      </div>

      {/* Cloud minimal */}
      <div style={{ marginTop: 16 }}>
        <Box color={C.yellow} dashed>
          <Label color={C.yellow}>☁ YOUR CLOUD (MINIMAL — optional)</Label>
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.yellow, fontSize: 12, fontWeight: 600, fontFamily: mono }}>License Server</div>
              <Sub>Validates Pro/Team keys. Tiny Node.js API on Render. ~₹500/mo.</Sub>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.yellow, fontSize: 12, fontWeight: 600, fontFamily: mono }}>Update Server</div>
              <Sub>Hosts Tauri app updates. GitHub Releases (free) or S3.</Sub>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.yellow, fontSize: 12, fontWeight: 600, fontFamily: mono }}>Team Sync (Phase 3)</div>
              <Sub>Opt-in encrypted sync for team dashboards. E2E encrypted.</Sub>
            </div>
          </div>
        </Box>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// DATA FLOW
// ════════════════════════════════════════
function DataFlow() {
  const flows = [
    {
      title: "REQUEST FLOW (every LLM call)",
      color: C.green,
      steps: [
        { label: "App sends request", detail: "POST localhost:4000/v1/openai/chat/completions", icon: "→" },
        { label: "Proxy parses request", detail: "Extract: model, messages, temperature, max_tokens from body", icon: "⊕" },
        { label: "Check budget", detail: "SELECT SUM(cost) FROM requests WHERE project_id=? AND date=today. If >= daily_limit → return 429 + budget exceeded error", icon: "💰" },
        { label: "Start timer", detail: "Record request_start_time = Date.now()", icon: "⏱" },
        { label: "Forward to provider", detail: "Proxy request to api.openai.com with original headers + API key", icon: "📡" },
        { label: "Receive response", detail: "Capture full response, record request_end_time", icon: "📥" },
        { label: "Count tokens", detail: "Extract usage.prompt_tokens + usage.completion_tokens from response (or estimate if not provided)", icon: "🔢" },
        { label: "Calculate cost", detail: "Look up model pricing table → prompt_tokens × input_price + completion_tokens × output_price", icon: "💲" },
        { label: "Async log to SQLite", detail: "INSERT INTO requests (...) — non-blocking, doesn't delay response", icon: "💾" },
        { label: "Check anomalies", detail: "If cost_this_hour > 5× avg_hourly_cost → trigger alert", icon: "🚨" },
        { label: "Return to app", detail: "Forward original provider response unchanged. App never knows proxy exists.", icon: "←" },
      ],
    },
    {
      title: "BUDGET KILL SWITCH FLOW",
      color: C.red,
      steps: [
        { label: "Request arrives", detail: "Normal LLM request to proxy", icon: "→" },
        { label: "Budget check", detail: "Today's spend ($47.20) vs daily limit ($50.00)", icon: "📊" },
        { label: "LIMIT EXCEEDED", detail: "$47.20 ≥ $50.00 → BLOCK", icon: "🛑" },
        { label: "Return error", detail: "HTTP 429: { error: 'LLM Observer: Daily budget limit ($50.00) reached. $47.20 spent today. Requests blocked until midnight UTC.' }", icon: "⛔" },
        { label: "Notify developer", detail: "OS notification + optional Slack/Discord webhook", icon: "🔔" },
        { label: "Log blocked request", detail: "INSERT INTO requests with status='blocked_budget' — so they can see what was blocked", icon: "💾" },
      ],
    },
    {
      title: "DASHBOARD REAL-TIME UPDATE FLOW",
      color: C.blue,
      steps: [
        { label: "New request logged", detail: "Proxy writes to SQLite", icon: "💾" },
        { label: "SSE event emitted", detail: "Server-Sent Events push to dashboard: { type: 'new_request', cost: 0.003, model: 'gpt-4o' }", icon: "📡" },
        { label: "Dashboard updates", detail: "React state updates → charts, counters, log table refresh in real-time", icon: "📊" },
        { label: "No polling needed", detail: "SSE is lightweight, persistent connection. Zero overhead vs WebSocket.", icon: "✓" },
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {flows.map((flow, fi) => (
        <div key={fi} style={{
          background: C.bgCard, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden",
        }}>
          <div style={{
            padding: "12px 20px", borderBottom: `1px solid ${C.border}`,
            color: flow.color, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5,
          }}>
            {flow.title}
          </div>
          <div style={{ padding: "8px 0" }}>
            {flow.steps.map((s, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 14,
                padding: "10px 20px",
                borderBottom: i < flow.steps.length - 1 ? `1px solid ${C.border}50` : "none",
              }}>
                <div style={{
                  minWidth: 32, height: 32, borderRadius: 8,
                  background: `${flow.color}12`, border: `1px solid ${flow.color}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, color: flow.color, fontFamily: mono, fontWeight: 700,
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: flow.color, fontSize: 13, fontWeight: 700, fontFamily: mono }}>{s.label}</div>
                  <div style={{ color: C.textDim, fontSize: 12, fontFamily: mono, marginTop: 3, lineHeight: 1.5 }}>{s.detail}</div>
                </div>
                <span style={{ fontSize: 16, marginTop: 2 }}>{s.icon}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════
// DATABASE SCHEMA
// ════════════════════════════════════════
function Database() {
  const tables = [
    {
      name: "projects",
      color: C.green,
      desc: "Organize requests by project/app",
      fields: [
        { name: "id", type: "TEXT PK", note: "UUID — 'proj_a1b2c3d4'" },
        { name: "name", type: "TEXT NOT NULL", note: "'My SaaS App', 'Side Project'" },
        { name: "api_key", type: "TEXT UNIQUE", note: "Local project key for proxy auth" },
        { name: "daily_budget", type: "REAL", note: "Daily spend limit in USD (e.g. 50.00)" },
        { name: "weekly_budget", type: "REAL", note: "Weekly limit (optional)" },
        { name: "monthly_budget", type: "REAL", note: "Monthly limit (optional)" },
        { name: "alert_threshold", type: "REAL DEFAULT 0.8", note: "Alert at 80% of budget" },
        { name: "kill_switch", type: "BOOLEAN DEFAULT 1", note: "Block requests when budget exceeded" },
        { name: "webhook_url", type: "TEXT", note: "Slack/Discord webhook for alerts" },
        { name: "created_at", type: "DATETIME" },
      ],
    },
    {
      name: "requests",
      color: C.blue,
      desc: "Every LLM API call logged — the core table",
      fields: [
        { name: "id", type: "TEXT PK", note: "UUID" },
        { name: "project_id", type: "TEXT FK→projects", note: "Which project made this call" },
        { name: "provider", type: "TEXT NOT NULL", note: "'openai' | 'anthropic' | 'google' | 'mistral' | 'groq'" },
        { name: "model", type: "TEXT NOT NULL", note: "'gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.5-flash'" },
        { name: "endpoint", type: "TEXT", note: "'/chat/completions', '/messages'" },
        { name: "prompt_tokens", type: "INTEGER", note: "Input token count" },
        { name: "completion_tokens", type: "INTEGER", note: "Output token count" },
        { name: "total_tokens", type: "INTEGER", note: "prompt + completion" },
        { name: "cost_usd", type: "REAL NOT NULL", note: "Calculated cost in USD (e.g. 0.0034)" },
        { name: "latency_ms", type: "INTEGER", note: "End-to-end response time in ms" },
        { name: "status_code", type: "INTEGER", note: "200, 429, 500, etc." },
        { name: "status", type: "TEXT DEFAULT 'success'", note: "'success' | 'error' | 'blocked_budget' | 'timeout'" },
        { name: "is_streaming", type: "BOOLEAN DEFAULT 0", note: "Was this a streaming request?" },
        { name: "has_tools", type: "BOOLEAN DEFAULT 0", note: "Did request use function/tool calling?" },
        { name: "error_message", type: "TEXT", note: "Error details if failed" },
        { name: "request_body", type: "TEXT", note: "Full request JSON (for debugging)" },
        { name: "response_body", type: "TEXT", note: "Full response JSON (for debugging)" },
        { name: "tags", type: "TEXT", note: "JSON array of custom tags ['production','chat-feature']" },
        { name: "created_at", type: "DATETIME NOT NULL", note: "Timestamp of request" },
      ],
    },
    {
      name: "model_pricing",
      color: C.orange,
      desc: "Cost per token for each model — auto-updated",
      fields: [
        { name: "id", type: "INTEGER PK AUTOINCREMENT" },
        { name: "provider", type: "TEXT NOT NULL" },
        { name: "model", type: "TEXT NOT NULL" },
        { name: "input_cost_per_1m", type: "REAL NOT NULL", note: "USD per 1M input tokens (e.g. 2.50)" },
        { name: "output_cost_per_1m", type: "REAL NOT NULL", note: "USD per 1M output tokens (e.g. 10.00)" },
        { name: "cached_input_cost_per_1m", type: "REAL", note: "Discounted rate for cached inputs" },
        { name: "effective_date", type: "DATE", note: "When this pricing took effect" },
        { name: "updated_at", type: "DATETIME" },
      ],
    },
    {
      name: "alerts",
      color: C.red,
      desc: "Alert history — budget warnings, anomalies, errors",
      fields: [
        { name: "id", type: "TEXT PK" },
        { name: "project_id", type: "TEXT FK→projects" },
        { name: "type", type: "TEXT NOT NULL", note: "'budget_warning' | 'budget_exceeded' | 'anomaly' | 'error_spike' | 'latency_spike'" },
        { name: "severity", type: "TEXT", note: "'info' | 'warning' | 'critical'" },
        { name: "message", type: "TEXT NOT NULL", note: "Human-readable alert message" },
        { name: "data", type: "TEXT", note: "JSON with alert context (current_spend, limit, etc.)" },
        { name: "notified_via", type: "TEXT", note: "'os_notification' | 'webhook' | 'both'" },
        { name: "acknowledged", type: "BOOLEAN DEFAULT 0" },
        { name: "created_at", type: "DATETIME" },
      ],
    },
    {
      name: "daily_stats",
      color: C.purple,
      desc: "Pre-aggregated daily stats for fast dashboard queries",
      fields: [
        { name: "id", type: "INTEGER PK AUTOINCREMENT" },
        { name: "project_id", type: "TEXT FK→projects" },
        { name: "date", type: "DATE NOT NULL", note: "'2026-03-08'" },
        { name: "provider", type: "TEXT NOT NULL" },
        { name: "model", type: "TEXT NOT NULL" },
        { name: "total_requests", type: "INTEGER DEFAULT 0" },
        { name: "total_tokens", type: "INTEGER DEFAULT 0" },
        { name: "total_cost_usd", type: "REAL DEFAULT 0" },
        { name: "avg_latency_ms", type: "INTEGER" },
        { name: "error_count", type: "INTEGER DEFAULT 0" },
        { name: "blocked_count", type: "INTEGER DEFAULT 0" },
      ],
    },
    {
      name: "settings",
      color: C.cyan,
      desc: "Global app configuration",
      fields: [
        { name: "key", type: "TEXT PK", note: "'proxy_port', 'dashboard_port', 'theme', 'license_key'" },
        { name: "value", type: "TEXT NOT NULL" },
        { name: "updated_at", type: "DATETIME" },
      ],
    },
  ];

  const [expanded, setExpanded] = useState(
    Object.fromEntries(tables.map((t) => [t.name, true]))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        background: `${C.cyan}08`, borderRadius: 10, padding: "12px 16px",
        border: `1px solid ${C.cyan}20`, color: C.cyan,
        fontSize: 12, fontFamily: mono,
      }}>
        ⊞ SQLite — 6 tables | Stored at ~/.llm-observer/data.db | Single file, zero config, instant backups via file copy
      </div>

      {tables.map((t) => (
        <div key={t.name} style={{
          background: C.bgCard, borderRadius: 10,
          border: `1px solid ${t.color}25`, overflow: "hidden",
        }}>
          <div
            onClick={() => setExpanded((p) => ({ ...p, [t.name]: !p[t.name] }))}
            style={{
              padding: "11px 18px", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              borderBottom: expanded[t.name] ? `1px solid ${t.color}15` : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: t.color, fontFamily: mono, fontWeight: 700, fontSize: 14 }}>
                {expanded[t.name] ? "▼" : "▶"} {t.name}
              </span>
              <span style={{ color: C.textDim, fontSize: 11, fontFamily: mono }}>{t.desc}</span>
            </div>
            <span style={{ color: C.textDim, fontSize: 11, fontFamily: mono }}>{t.fields.length} cols</span>
          </div>
          {expanded[t.name] && (
            <div>
              {t.fields.map((f, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "baseline", padding: "6px 18px", gap: 8,
                  borderBottom: i < t.fields.length - 1 ? `1px solid ${C.border}60` : "none",
                  fontSize: 12, fontFamily: mono,
                }}>
                  <span style={{ color: t.color, fontWeight: 600, minWidth: 190 }}>{f.name}</span>
                  <span style={{ color: C.textDim, minWidth: 180 }}>{f.type}</span>
                  {f.note && <span style={{ color: `${C.textDim}99`, fontSize: 11, fontStyle: "italic" }}>{f.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Indexes */}
      <div style={{ background: C.bgCard, borderRadius: 10, padding: 18, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.green, fontFamily: mono, fontWeight: 700, fontSize: 13, marginBottom: 12, letterSpacing: 1 }}>
          ⚡ CRITICAL INDEXES
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: mono, fontSize: 12, color: C.text }}>
          {[
            "CREATE INDEX idx_requests_project_date ON requests(project_id, created_at);",
            "CREATE INDEX idx_requests_provider_model ON requests(provider, model);",
            "CREATE INDEX idx_requests_status ON requests(status);",
            "CREATE INDEX idx_requests_cost ON requests(cost_usd);",
            "CREATE UNIQUE INDEX idx_daily_stats_unique ON daily_stats(project_id, date, provider, model);",
            "CREATE INDEX idx_alerts_project_type ON alerts(project_id, type, created_at);",
          ].map((idx, i) => (
            <div key={i} style={{ padding: "6px 10px", background: `${C.green}06`, borderRadius: 6 }}>
              <span style={{ color: C.green }}>{idx}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Data retention */}
      <div style={{ background: C.bgCard, borderRadius: 10, padding: 18, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.yellow, fontFamily: mono, fontWeight: 700, fontSize: 13, marginBottom: 12, letterSpacing: 1 }}>
          🗑 DATA RETENTION STRATEGY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: mono, fontSize: 12 }}>
          {[
            { plan: "Free", detail: "Full request logs: 7 days → then auto-purged. daily_stats kept forever.", color: C.textDim },
            { plan: "Pro", detail: "Full request logs: 90 days → then auto-purged. daily_stats kept forever.", color: C.blue },
            { plan: "Team", detail: "Full request logs: 1 year. daily_stats kept forever. Export anytime.", color: C.purple },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ color: r.color, fontWeight: 700, minWidth: 50 }}>{r.plan}</span>
              <span style={{ color: C.text }}>{r.detail}</span>
            </div>
          ))}
        </div>
        <div style={{ color: C.textDim, fontSize: 11, marginTop: 10, fontFamily: mono }}>
          daily_stats table is tiny (~1KB/day/model) so it costs nothing to keep forever. This powers long-term cost trend charts.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// API SURFACE
// ════════════════════════════════════════
function ApiSurface() {
  const groups = [
    {
      title: "PROXY ENDPOINTS (developer's app calls these)",
      color: C.green,
      desc: "Drop-in replacement for provider APIs. Same request format, same response format.",
      endpoints: [
        { method: "POST", path: "/v1/openai/*", desc: "Proxies to api.openai.com — supports /chat/completions, /embeddings, /images, etc." },
        { method: "POST", path: "/v1/anthropic/*", desc: "Proxies to api.anthropic.com — supports /messages" },
        { method: "POST", path: "/v1/google/*", desc: "Proxies to generativelanguage.googleapis.com" },
        { method: "POST", path: "/v1/mistral/*", desc: "Proxies to api.mistral.ai" },
        { method: "POST", path: "/v1/groq/*", desc: "Proxies to api.groq.com" },
        { method: "POST", path: "/v1/custom/:baseUrl/*", desc: "Proxy to any OpenAI-compatible endpoint (Ollama, vLLM)" },
      ],
    },
    {
      title: "DASHBOARD API (React dashboard calls these)",
      color: C.blue,
      desc: "Internal API served on localhost:4001/api — powers the dashboard UI",
      endpoints: [
        { method: "GET", path: "/api/stats/overview", desc: "Today's spend, total requests, avg latency, error rate" },
        { method: "GET", path: "/api/stats/timeline?range=7d", desc: "Cost & request count over time (hourly/daily buckets)" },
        { method: "GET", path: "/api/stats/by-model", desc: "Breakdown: cost, requests, avg latency per model" },
        { method: "GET", path: "/api/stats/by-provider", desc: "Breakdown by provider (OpenAI vs Claude vs Gemini)" },
        { method: "GET", path: "/api/requests?page=1&limit=50", desc: "Paginated request log with filters" },
        { method: "GET", path: "/api/requests/:id", desc: "Full request detail (prompt, response, tokens, cost)" },
        { method: "GET", path: "/api/projects", desc: "List all projects with current spend" },
        { method: "POST", path: "/api/projects", desc: "Create new project with budget settings" },
        { method: "PUT", path: "/api/projects/:id", desc: "Update project name, budgets, webhook" },
        { method: "DELETE", path: "/api/projects/:id", desc: "Delete project and its data" },
        { method: "GET", path: "/api/alerts?acknowledged=false", desc: "List alerts (filterable)" },
        { method: "PUT", path: "/api/alerts/:id/ack", desc: "Acknowledge an alert" },
        { method: "GET", path: "/api/pricing", desc: "Current model pricing table" },
        { method: "GET", path: "/api/events", desc: "SSE stream — real-time updates for dashboard" },
      ],
    },
  ];

  const mc = { GET: C.green, POST: C.blue, PUT: C.orange, DELETE: C.red };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map((g, gi) => (
        <div key={gi} style={{ background: C.bgCard, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ color: g.color, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5 }}>{g.title}</div>
            <div style={{ color: C.textDim, fontSize: 11, fontFamily: mono, marginTop: 4 }}>{g.desc}</div>
          </div>
          {g.endpoints.map((ep, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", padding: "9px 20px", gap: 12,
              borderBottom: i < g.endpoints.length - 1 ? `1px solid ${C.border}50` : "none",
            }}>
              <span style={{
                background: `${mc[ep.method]}15`, color: mc[ep.method],
                padding: "3px 8px", borderRadius: 4, fontSize: 10,
                fontWeight: 700, fontFamily: mono, minWidth: 52, textAlign: "center",
              }}>{ep.method}</span>
              <span style={{ color: C.textBright, fontSize: 12, fontFamily: mono, minWidth: 280 }}>{ep.path}</span>
              <span style={{ color: C.textDim, fontSize: 11, fontFamily: mono }}>{ep.desc}</span>
            </div>
          ))}
        </div>
      ))}

      {/* Usage Example */}
      <div style={{ background: C.bgCard, borderRadius: 12, padding: 20, border: `1px solid ${C.green}20` }}>
        <div style={{ color: C.green, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5, marginBottom: 14 }}>
          INTEGRATION EXAMPLE — ONE LINE CHANGE
        </div>
        <pre style={{
          background: C.bg, borderRadius: 8, padding: 16,
          fontFamily: mono, fontSize: 12, color: C.text, lineHeight: 1.8,
          border: `1px solid ${C.border}`, overflow: "auto", margin: 0,
        }}>{`// BEFORE (direct to OpenAI)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AFTER (through LLM Observer proxy — ONE line added)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "http://localhost:4000/v1/openai",  // ← only change
});

// Everything else stays EXACTLY the same
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});`}</pre>
        <div style={{ color: C.textDim, fontSize: 11, fontFamily: mono, marginTop: 10 }}>
          Same pattern works for Anthropic SDK, Google AI SDK, etc. Change base URL → done.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// CLI DESIGN
// ════════════════════════════════════════
function CliDesign() {
  const commands = [
    { cmd: "llm-observer start", desc: "Start proxy (port 4000) + dashboard (port 4001)", flags: "--port 4000 --dashboard-port 4001 --no-dashboard" },
    { cmd: "llm-observer status", desc: "Show running status, today's spend, active project" },
    { cmd: "llm-observer projects list", desc: "List all projects with current spend" },
    { cmd: "llm-observer projects create", desc: "Interactive: name, daily budget, webhook URL" },
    { cmd: "llm-observer projects delete <id>", desc: "Delete a project" },
    { cmd: "llm-observer stats", desc: "Quick stats in terminal: today/week/month spend" },
    { cmd: "llm-observer stats --model gpt-4o", desc: "Filter stats by model" },
    { cmd: "llm-observer logs", desc: "Live tail of requests (like 'tail -f')" },
    { cmd: "llm-observer logs --provider anthropic", desc: "Filter logs by provider" },
    { cmd: "llm-observer budget set 50 --daily", desc: "Set daily budget to $50" },
    { cmd: "llm-observer export --format csv --range 30d", desc: "Export request data" },
    { cmd: "llm-observer config", desc: "View/edit settings (ports, theme, webhook)" },
    { cmd: "llm-observer stop", desc: "Stop proxy and dashboard gracefully" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Terminal Preview */}
      <div style={{
        background: "#0c0c0c", borderRadius: 12, overflow: "hidden",
        border: `1px solid #2a2a2a`, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{
          padding: "8px 14px", background: "#1a1a1a",
          display: "flex", alignItems: "center", gap: 8,
          borderBottom: "1px solid #2a2a2a",
        }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ffbd2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
          <span style={{ color: "#666", fontSize: 12, fontFamily: mono, marginLeft: 8 }}>Terminal — llm-observer</span>
        </div>
        <pre style={{
          padding: 20, margin: 0, fontFamily: mono, fontSize: 13,
          lineHeight: 1.7, color: "#ccc", whiteSpace: "pre-wrap",
        }}>
{`$ npx llm-observer start

`}<span style={{ color: C.green }}>  ╔══════════════════════════════════════════╗
  ║         LLM Observer v1.0.0              ║
  ╚══════════════════════════════════════════╝</span>{`

  `}<span style={{ color: C.green }}>✓</span>{` Proxy running      → http://localhost:4000
  `}<span style={{ color: C.blue }}>✓</span>{` Dashboard ready    → http://localhost:4001
  `}<span style={{ color: C.cyan }}>✓</span>{` Database loaded    → ~/.llm-observer/data.db
  `}<span style={{ color: C.purple }}>✓</span>{` Active project     → My SaaS App
  `}<span style={{ color: C.orange }}>✓</span>{` Daily budget       → $50.00 (kill switch: ON)
  `}<span style={{ color: C.yellow }}>✓</span>{` Webhook            → Slack connected

  `}<span style={{ color: C.textDim }}>Watching for LLM requests...</span>{`

  `}<span style={{ color: C.green }}>│</span>{` `}<span style={{ color: C.textDim }}>14:23:01</span>{` `}<span style={{ color: C.green }}>POST</span>{` openai/gpt-4o      `}<span style={{ color: C.cyan }}>847tk</span>{`  `}<span style={{ color: C.orange }}>$0.0038</span>{`  `}<span style={{ color: C.green }}>1.2s</span>{`  ✓
  `}<span style={{ color: C.green }}>│</span>{` `}<span style={{ color: C.textDim }}>14:23:03</span>{` `}<span style={{ color: C.orange }}>POST</span>{` anthropic/haiku     `}<span style={{ color: C.cyan }}>234tk</span>{`  `}<span style={{ color: C.orange }}>$0.0002</span>{`  `}<span style={{ color: C.green }}>0.4s</span>{`  ✓
  `}<span style={{ color: C.green }}>│</span>{` `}<span style={{ color: C.textDim }}>14:23:05</span>{` `}<span style={{ color: C.blue }}>POST</span>{` google/gemini-flash `}<span style={{ color: C.cyan }}>512tk</span>{`  `}<span style={{ color: C.orange }}>$0.0001</span>{`  `}<span style={{ color: C.green }}>0.3s</span>{`  ✓
  `}<span style={{ color: C.red }}>│</span>{` `}<span style={{ color: C.textDim }}>14:23:08</span>{` `}<span style={{ color: C.green }}>POST</span>{` openai/gpt-4o      `}<span style={{ color: C.cyan }}>2.1Ktk</span>{` `}<span style={{ color: C.red }}>$0.0120</span>{`  `}<span style={{ color: C.red }}>4.8s</span>{`  ⚠ slow
  
  `}<span style={{ color: C.yellow }}>⚡ Today: $12.47 / $50.00 (24.9%)</span>{`  |  Requests: 847  |  Avg: 1.1s`}
        </pre>
      </div>

      {/* Commands */}
      <div style={{ background: C.bgCard, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        <div style={{
          padding: "12px 20px", borderBottom: `1px solid ${C.border}`,
          color: C.green, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5,
        }}>
          CLI COMMANDS
        </div>
        {commands.map((c, i) => (
          <div key={i} style={{
            padding: "10px 20px",
            borderBottom: i < commands.length - 1 ? `1px solid ${C.border}50` : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ color: C.green, fontSize: 12, fontFamily: mono, fontWeight: 700 }}>$</span>
              <span style={{ color: C.textBright, fontSize: 13, fontFamily: mono }}>{c.cmd}</span>
            </div>
            <div style={{ color: C.textDim, fontSize: 11, fontFamily: mono, marginTop: 4, paddingLeft: 20 }}>{c.desc}</div>
            {c.flags && <div style={{ color: `${C.purple}90`, fontSize: 11, fontFamily: mono, marginTop: 2, paddingLeft: 20 }}>Flags: {c.flags}</div>}
          </div>
        ))}
      </div>

      {/* npm package info */}
      <div style={{
        background: `${C.red}08`, borderRadius: 12, padding: 20,
        border: `1px solid ${C.red}20`,
      }}>
        <div style={{ color: C.red, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5, marginBottom: 10 }}>
          NPM PACKAGE CONFIG
        </div>
        <pre style={{
          fontFamily: mono, fontSize: 12, color: C.text, lineHeight: 1.7, margin: 0,
        }}>{`Package name:  llm-observer  (or llm-obs for short alias)
Install:       npm install -g llm-observer
Quick start:   npx llm-observer start
Binary name:   llm-observer (added to PATH on global install)
Config dir:    ~/.llm-observer/
  ├── data.db        (SQLite database)
  ├── config.json    (user settings)
  └── logs/          (error logs)`}</pre>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// TAURI MIGRATION
// ════════════════════════════════════════
function TauriMigration() {
  const phases = [
    {
      title: "PHASE 1 → PHASE 2: WRAPPING CLI IN TAURI",
      color: C.purple,
      approach: "Sidecar Strategy",
      desc: "Your working Node.js proxy runs as a sidecar process inside Tauri. React dashboard renders in Tauri's native webview. Zero rewrite needed.",
      steps: [
        "Install Tauri CLI: cargo install tauri-cli",
        "Initialize Tauri in your project: cargo tauri init",
        "Point Tauri's webview to your React dashboard build output",
        "Configure sidecar: bundle your Node.js proxy as a sidecar binary using pkg or nexe",
        "Tauri launches the sidecar on app start → proxy runs in background",
        "Add system tray icon with status indicator (green = running, red = stopped)",
        "Add native OS notifications via Tauri's notification API",
        "Configure auto-start on login via Tauri's autostart plugin",
        "Set up auto-updater pointing to GitHub Releases",
        "Package: cargo tauri build → .dmg (Mac) + .msi (Windows) + .AppImage (Linux)",
      ],
    },
    {
      title: "PHASE 3 (OPTIONAL): RUST-NATIVE PROXY",
      color: C.orange,
      approach: "Full Rust Migration",
      desc: "Replace Node.js sidecar with a Rust-native proxy for maximum performance. Only do this if you need sub-millisecond overhead.",
      steps: [
        "Rewrite proxy in Rust using hyper or axum (HTTP framework)",
        "Use rusqlite for SQLite access (same database, just native access)",
        "Use Tauri commands to communicate between Rust backend and React frontend",
        "Remove Node.js sidecar dependency entirely",
        "Result: single binary, ~5MB, ~10MB RAM, instant startup",
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Why sidecar first */}
      <div style={{
        background: `${C.green}08`, borderRadius: 12, padding: 20,
        border: `1px solid ${C.green}20`, boxShadow: C.greenGlow,
      }}>
        <div style={{ color: C.green, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5, marginBottom: 10 }}>
          WHY SIDECAR FIRST (SMART STRATEGY)
        </div>
        <div style={{ color: C.text, fontSize: 13, fontFamily: sans, lineHeight: 1.7 }}>
          The sidecar approach means your battle-tested Node.js proxy code runs exactly as-is inside Tauri. No rewriting, no new bugs, no delays. You get the Tauri benefits (5MB app, native webview, system tray, auto-update) immediately while keeping your proven backend. Learn Rust gradually on your own schedule. Migrate the proxy to Rust only when you have time AND a reason.
        </div>
      </div>

      {/* Phases */}
      {phases.map((p, pi) => (
        <div key={pi} style={{
          background: C.bgCard, borderRadius: 12, border: `1px solid ${p.color}25`, overflow: "hidden",
        }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${p.color}15` }}>
            <div style={{ color: p.color, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5 }}>{p.title}</div>
            <div style={{ color: C.text, fontSize: 12, fontFamily: mono, marginTop: 6 }}>
              Approach: <span style={{ color: p.color, fontWeight: 700 }}>{p.approach}</span>
            </div>
            <div style={{ color: C.textDim, fontSize: 12, fontFamily: sans, marginTop: 4 }}>{p.desc}</div>
          </div>
          <div style={{ padding: "8px 0" }}>
            {p.steps.map((s, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 20px",
                borderBottom: i < p.steps.length - 1 ? `1px solid ${C.border}50` : "none",
              }}>
                <span style={{
                  color: p.color, fontWeight: 700, fontSize: 12, fontFamily: mono,
                  minWidth: 22, textAlign: "right",
                }}>{i + 1}.</span>
                <span style={{ color: C.text, fontSize: 12, fontFamily: mono, lineHeight: 1.5 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Tauri config */}
      <div style={{ background: C.bgCard, borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.cyan, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5, marginBottom: 14 }}>
          TAURI FEATURES YOU'LL USE
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { feature: "System Tray", desc: "Always-running icon in taskbar. Green dot = proxy active. Click to open dashboard.", api: "tauri::SystemTray" },
            { feature: "Native Notifications", desc: "Budget warnings, anomaly alerts — real OS notifications, not browser popups.", api: "tauri-plugin-notification" },
            { feature: "Autostart", desc: "Start on login. Proxy runs invisibly in background. Developer never thinks about it.", api: "tauri-plugin-autostart" },
            { feature: "Auto-Updater", desc: "Check GitHub Releases for updates. Download + install silently. Always latest version.", api: "tauri-plugin-updater" },
            { feature: "Sidecar", desc: "Bundle Node.js proxy binary. Tauri manages its lifecycle (start/stop/restart).", api: "tauri::api::process::Command" },
            { feature: "Shell Commands", desc: "Open browser to dashboard URL. Open terminal. System interactions.", api: "tauri-plugin-shell" },
          ].map((f, i) => (
            <div key={i} style={{
              background: `${C.cyan}06`, borderRadius: 8, padding: "12px 14px",
              border: `1px solid ${C.cyan}12`,
            }}>
              <div style={{ color: C.cyan, fontWeight: 700, fontSize: 13, fontFamily: mono }}>{f.feature}</div>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: mono, marginTop: 4 }}>{f.desc}</div>
              <div style={{ color: `${C.purple}80`, fontSize: 10, fontFamily: mono, marginTop: 6 }}>{f.api}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// PROJECT STRUCTURE
// ════════════════════════════════════════
function FolderStructure() {
  const structure = `llm-observer/
│
├── packages/
│   ├── proxy/                          # Core proxy engine (Node.js)
│   │   ├── src/
│   │   │   ├── index.ts                # Entry point — starts proxy server
│   │   │   ├── proxy.ts                # HTTP proxy logic — intercept + forward
│   │   │   ├── providers/
│   │   │   │   ├── openai.ts           # OpenAI request/response parser
│   │   │   │   ├── anthropic.ts        # Anthropic/Claude parser
│   │   │   │   ├── google.ts           # Gemini parser
│   │   │   │   ├── mistral.ts          # Mistral parser
│   │   │   │   ├── groq.ts             # Groq parser
│   │   │   │   └── base.ts             # Base provider interface
│   │   │   ├── token-counter.ts        # Token counting per provider
│   │   │   ├── cost-calculator.ts      # Cost calculation using pricing table
│   │   │   ├── budget-guard.ts         # Budget check + kill switch logic
│   │   │   ├── anomaly-detector.ts     # Spike detection algorithm
│   │   │   ├── alert-manager.ts        # OS notifications + webhooks
│   │   │   ├── stream-handler.ts       # Handle SSE streaming responses
│   │   │   └── logger.ts               # Async SQLite logging
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── database/                       # SQLite database layer
│   │   ├── src/
│   │   │   ├── index.ts                # DB connection + initialization
│   │   │   ├── migrations/
│   │   │   │   └── 001_initial.sql     # Create tables + indexes
│   │   │   ├── repositories/
│   │   │   │   ├── requests.repo.ts    # CRUD for requests table
│   │   │   │   ├── projects.repo.ts    # CRUD for projects table
│   │   │   │   ├── alerts.repo.ts      # CRUD for alerts table
│   │   │   │   ├── stats.repo.ts       # Aggregation queries for dashboard
│   │   │   │   └── pricing.repo.ts     # Model pricing lookups
│   │   │   └── seed/
│   │   │       └── pricing.ts          # Seed current model prices
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/                      # React dashboard (runs in browser or Tauri)
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── pages/
│   │   │   │   ├── OverviewPage.tsx    # Main dashboard — spend, charts, live counter
│   │   │   │   ├── RequestsPage.tsx    # Request log viewer + search + filters
│   │   │   │   ├── RequestDetail.tsx   # Full request/response inspector
│   │   │   │   ├── ProjectsPage.tsx    # Manage projects + budgets
│   │   │   │   ├── AlertsPage.tsx      # Alert history + settings
│   │   │   │   └── SettingsPage.tsx    # App configuration
│   │   │   ├── components/
│   │   │   │   ├── SpendCounter.tsx    # Animated real-time spend display
│   │   │   │   ├── CostChart.tsx       # Cost over time (recharts)
│   │   │   │   ├── ModelBreakdown.tsx  # Pie/bar chart by model
│   │   │   │   ├── RequestTable.tsx    # Sortable, filterable log table
│   │   │   │   ├── LatencyGraph.tsx    # Latency per model over time
│   │   │   │   ├── BudgetMeter.tsx     # Visual budget usage indicator
│   │   │   │   └── LiveIndicator.tsx   # Pulsing dot showing proxy is running
│   │   │   ├── hooks/
│   │   │   │   ├── useSSE.ts           # Server-Sent Events for real-time updates
│   │   │   │   ├── useStats.ts         # Fetch dashboard stats
│   │   │   │   └── useRequests.ts      # Fetch + filter request logs
│   │   │   └── lib/
│   │   │       ├── api.ts              # API client for dashboard endpoints
│   │   │       └── formatters.ts       # Format currency, tokens, latency
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── tailwind.config.js
│   │
│   └── cli/                            # CLI interface
│       ├── src/
│       │   ├── index.ts                # Commander.js CLI entry point
│       │   ├── commands/
│       │   │   ├── start.ts            # Start proxy + dashboard
│       │   │   ├── stop.ts             # Graceful shutdown
│       │   │   ├── status.ts           # Show running status
│       │   │   ├── stats.ts            # Terminal stats display
│       │   │   ├── logs.ts             # Live log tail
│       │   │   ├── projects.ts         # Project CRUD commands
│       │   │   ├── budget.ts           # Budget management
│       │   │   ├── export.ts           # Data export (CSV/JSON)
│       │   │   └── config.ts           # Settings management
│       │   └── ui/
│       │       └── terminal-ui.ts      # Chalk + ora for pretty terminal output
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   └── tauri/                          # Phase 2: Tauri desktop wrapper
│       ├── src-tauri/
│       │   ├── src/
│       │   │   └── main.rs             # Tauri app entry + sidecar management
│       │   ├── tauri.conf.json         # Tauri configuration
│       │   ├── icons/                  # App icons for all platforms
│       │   └── Cargo.toml
│       └── (points to ../packages/dashboard as frontend)
│
├── packages.json                       # Monorepo root (npm workspaces)
├── turbo.json                          # Turborepo config (optional)
├── .gitignore
├── LICENSE
└── README.md                           # This IS your marketing. Make it beautiful.`;

  return (
    <div style={{
      background: "#080c12", borderRadius: 14, padding: 24,
      border: `1px solid ${C.border}`, overflow: "auto",
    }}>
      <pre style={{
        color: C.text, fontSize: 12, fontFamily: mono,
        lineHeight: 1.65, margin: 0, whiteSpace: "pre",
      }}>
        {structure}
      </pre>
    </div>
  );
}

// ════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════
export default function App() {
  const [active, setActive] = useState("overview");

  const renderTab = () => {
    switch (active) {
      case "overview": return <Overview />;
      case "arch": return <ArchDiagram />;
      case "data-flow": return <DataFlow />;
      case "db": return <Database />;
      case "api": return <ApiSurface />;
      case "cli": return <CliDesign />;
      case "tauri": return <TauriMigration />;
      case "folder": return <FolderStructure />;
      default: return <Overview />;
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: sans,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ padding: "20px 24px 0", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.green}, ${C.greenDim})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: C.greenGlow,
          }}>
            ⬡
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.textBright, fontFamily: mono, letterSpacing: -0.5 }}>
              LLM Observer
            </div>
            <div style={{ fontSize: 12, color: C.textDim, fontFamily: mono }}>
              Architecture Blueprint — CLI + Tauri Desktop
            </div>
          </div>
          <div style={{
            marginLeft: "auto", background: `${C.green}12`,
            padding: "6px 14px", borderRadius: 8,
            color: C.green, fontSize: 11, fontWeight: 700, fontFamily: mono,
            border: `1px solid ${C.green}25`,
          }}>
            PRIVACY-FIRST • LOCAL-ONLY • OPEN SOURCE CORE
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 1, overflowX: "auto" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                padding: "9px 14px",
                background: active === t.id ? C.bgHover : "transparent",
                border: "none",
                borderBottom: active === t.id ? `2px solid ${C.green}` : "2px solid transparent",
                color: active === t.id ? C.green : C.textDim,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: mono, whiteSpace: "nowrap",
                borderRadius: "6px 6px 0 0",
                transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        {renderTab()}
      </div>
    </div>
  );
}
