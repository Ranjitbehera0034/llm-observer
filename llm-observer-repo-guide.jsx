import { useState } from "react";

const C = {
  bg: "#04090f", bgCard: "#0a1018", border: "#14222e",
  text: "#c0d0dc", textDim: "#4a6272", textBright: "#eaf2f8",
  green: "#3dffa0", blue: "#4ac8ff", orange: "#ffa347",
  red: "#ff5a5a", purple: "#b88aff", cyan: "#4affea", yellow: "#ffe24a",
};
const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

const tabs = [
  { id: "structure", label: "Repo Structure" },
  { id: "branching", label: "Branching Strategy" },
  { id: "publish", label: "What to Publish" },
  { id: "commands", label: "Git Commands" },
  { id: "files", label: "Files Created" },
];

function Structure() {
  const tree = `llm-observer/
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md              # Bug report template
│   │   └── feature_request.md         # Feature request template
│   └── workflows/
│       ├── ci.yml                     # Lint + test + build on every PR
│       ├── publish.yml                # Publish to npm on GitHub Release
│       └── desktop-release.yml        # Build Tauri app for Mac/Win/Linux
│
├── packages/
│   ├── proxy/                         # Core proxy engine
│   │   ├── src/
│   │   │   ├── index.ts               # Entry — starts proxy server
│   │   │   ├── proxy.ts               # HTTP proxy routing logic
│   │   │   ├── providers/
│   │   │   │   ├── base.ts            # Provider interface
│   │   │   │   ├── openai.ts
│   │   │   │   ├── anthropic.ts
│   │   │   │   ├── google.ts
│   │   │   │   ├── mistral.ts
│   │   │   │   └── groq.ts
│   │   │   ├── token-counter.ts
│   │   │   ├── cost-calculator.ts
│   │   │   ├── budget-guard.ts
│   │   │   ├── anomaly-detector.ts
│   │   │   ├── alert-manager.ts
│   │   │   ├── stream-handler.ts
│   │   │   └── logger.ts
│   │   ├── package.json               # name: "@llm-observer/proxy"
│   │   └── tsconfig.json              # extends ../../tsconfig.base.json
│   │
│   ├── database/                      # SQLite database layer
│   │   ├── src/
│   │   │   ├── index.ts               # DB init + connection
│   │   │   ├── migrations/
│   │   │   │   └── 001_initial.sql    # All tables + indexes
│   │   │   ├── repositories/
│   │   │   │   ├── requests.repo.ts
│   │   │   │   ├── projects.repo.ts
│   │   │   │   ├── alerts.repo.ts
│   │   │   │   ├── stats.repo.ts
│   │   │   │   └── pricing.repo.ts
│   │   │   └── seed/
│   │   │       └── pricing.ts         # Current model pricing data
│   │   ├── package.json               # name: "@llm-observer/database"
│   │   └── tsconfig.json
│   │
│   ├── dashboard/                     # React dashboard
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── pages/
│   │   │   │   ├── OverviewPage.tsx
│   │   │   │   ├── RequestsPage.tsx
│   │   │   │   ├── RequestDetail.tsx
│   │   │   │   ├── ProjectsPage.tsx
│   │   │   │   ├── AlertsPage.tsx
│   │   │   │   └── SettingsPage.tsx
│   │   │   ├── components/
│   │   │   │   ├── SpendCounter.tsx
│   │   │   │   ├── CostChart.tsx
│   │   │   │   ├── ModelBreakdown.tsx
│   │   │   │   ├── RequestTable.tsx
│   │   │   │   ├── BudgetMeter.tsx
│   │   │   │   └── LiveIndicator.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useSSE.ts
│   │   │   │   ├── useStats.ts
│   │   │   │   └── useRequests.ts
│   │   │   └── lib/
│   │   │       ├── api.ts
│   │   │       └── formatters.ts
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── package.json               # name: "@llm-observer/dashboard"
│   │   └── tsconfig.json
│   │
│   └── cli/                           # CLI — THIS is what gets published to npm
│       ├── src/
│       │   ├── index.ts               # Commander.js entry point
│       │   ├── commands/
│       │   │   ├── start.ts
│       │   │   ├── stop.ts
│       │   │   ├── status.ts
│       │   │   ├── stats.ts
│       │   │   ├── logs.ts
│       │   │   ├── projects.ts
│       │   │   ├── budget.ts
│       │   │   ├── export.ts
│       │   │   ├── config.ts
│       │   │   └── team.ts
│       │   └── ui/
│       │       └── terminal-ui.ts
│       ├── package.json               # name: "llm-observer" ← npm package name!
│       └── tsconfig.json
│
├── apps/
│   └── tauri/                         # Phase 2: Desktop app
│       ├── src-tauri/
│       │   ├── src/
│       │   │   └── main.rs
│       │   ├── tauri.conf.json
│       │   ├── icons/
│       │   └── Cargo.toml
│       └── (points to packages/dashboard)
│
├── docs/
│   └── assets/                        # Screenshots, GIFs for README
│
├── .github/                           # CI/CD workflows
├── .gitignore
├── .npmrc
├── tsconfig.base.json                 # Shared TypeScript config
├── package.json                       # Root — monorepo workspaces config
├── README.md                          # Your landing page (already created!)
├── CONTRIBUTING.md                    # Contributor guide
└── LICENSE                            # MIT`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: `${C.green}08`, borderRadius: 12, padding: "16px 20px", border: `1px solid ${C.green}20` }}>
        <div style={{ color: C.green, fontSize: 13, fontFamily: mono, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>KEY INSIGHT</div>
        <div style={{ color: C.text, fontSize: 14, fontFamily: sans, lineHeight: 1.7 }}>
          This is a <strong style={{ color: C.green }}>monorepo with npm workspaces</strong>. Four packages share one repo. But only <strong style={{ color: C.yellow }}>packages/cli</strong> gets published to npm as "llm-observer". The other three packages are internal dependencies bundled into the CLI.
        </div>
      </div>
      <div style={{ background: "#080c12", borderRadius: 14, padding: 24, border: `1px solid ${C.border}`, overflow: "auto" }}>
        <pre style={{ color: C.text, fontSize: 12, fontFamily: mono, lineHeight: 1.6, margin: 0, whiteSpace: "pre" }}>{tree}</pre>
      </div>
      <div style={{ background: C.bgCard, borderRadius: 12, padding: 20, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.orange, fontSize: 13, fontFamily: mono, fontWeight: 700, letterSpacing: 1.5, marginBottom: 12 }}>PACKAGE NAMING</div>
        {[
          { pkg: "@llm-observer/proxy", published: "No", note: "Internal — bundled into CLI" },
          { pkg: "@llm-observer/database", published: "No", note: "Internal — bundled into CLI" },
          { pkg: "@llm-observer/dashboard", published: "No", note: "Internal — built and served by CLI" },
          { pkg: "llm-observer", published: "YES → npm", note: "The CLI package users install. Contains all the others." },
        ].map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < 3 ? `1px solid ${C.border}50` : "none" }}>
            <span style={{ color: C.cyan, fontFamily: mono, fontSize: 13, fontWeight: 600, minWidth: 220 }}>{p.pkg}</span>
            <span style={{ color: p.published.startsWith("YES") ? C.green : C.textDim, fontFamily: mono, fontSize: 12, fontWeight: 700, minWidth: 100 }}>{p.published}</span>
            <span style={{ color: C.textDim, fontFamily: mono, fontSize: 12 }}>{p.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Branching() {
  const branches = [
    { name: "main", color: C.green, desc: "Production-ready code only. Tagged releases go here.", rules: "Protected. Only merged from 'develop' via PR. Every merge = a version bump + npm release.", mergeFrom: "develop (via PR)" },
    { name: "develop", color: C.blue, desc: "Integration branch. All feature work merges here first.", rules: "Default branch for PRs. Must pass CI. Code reviewed before merge.", mergeFrom: "feature/*, fix/*, docs/*" },
    { name: "feature/*", color: C.purple, desc: "New features. One branch per feature.", rules: "Branch from develop. Merge back to develop via PR. Delete after merge.", example: "feature/openai-provider, feature/budget-kill-switch, feature/dashboard-charts" },
    { name: "fix/*", color: C.orange, desc: "Bug fixes.", rules: "Branch from develop (or main for hotfixes). Merge to develop via PR.", example: "fix/streaming-token-count, fix/sqlite-connection-leak" },
    { name: "hotfix/*", color: C.red, desc: "Critical production fixes that can't wait.", rules: "Branch from main. Merge to BOTH main AND develop. Tag immediately.", example: "hotfix/kill-switch-bypass, hotfix/crash-on-startup" },
    { name: "docs/*", color: C.cyan, desc: "Documentation changes only.", rules: "Branch from develop. Merge to develop.", example: "docs/cli-reference, docs/api-guide" },
    { name: "release/*", color: C.yellow, desc: "Prepare a release. Version bumps, changelog, final testing.", rules: "Branch from develop. Merge to main + tag. Then merge back to develop.", example: "release/v1.0.0, release/v1.1.0" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Visual branch diagram */}
      <div style={{ background: C.bgCard, borderRadius: 12, padding: 24, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.textBright, fontSize: 14, fontFamily: mono, fontWeight: 700, marginBottom: 16 }}>BRANCH FLOW (Git Flow Simplified)</div>
        <pre style={{ color: C.text, fontFamily: mono, fontSize: 12, lineHeight: 1.8, margin: 0 }}>
{`  `}<span style={{ color: C.green }}>main</span>{`      ──●────────────────────●──────────────●──── (releases only)
                  ↑                    ↑              ↑
  `}<span style={{ color: C.yellow }}>release/*</span>{`           ↑         ┌──release/v1.0──┐    release/v1.1
                  ↑         │                │
  `}<span style={{ color: C.blue }}>develop</span>{`   ──●──●──●──●──●──●──●──●──●──●──●──●──●── (integration)
               ↑  ↑     ↑        ↑     ↑        ↑
  `}<span style={{ color: C.purple }}>feature/*</span>{`  │  └─feat─┘   └──feat──┘     │   └──feat──
  `}<span style={{ color: C.orange }}>fix/*</span>{`      └───fix───┘              └─fix─┘
  `}<span style={{ color: C.red }}>hotfix/*</span>{`                    (from main, merge to main + develop)`}
        </pre>
      </div>

      {/* Branch details */}
      {branches.map((b, i) => (
        <div key={i} style={{ background: C.bgCard, borderRadius: 10, border: `1px solid ${b.color}20`, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${b.color}12` }}>
            <span style={{ background: `${b.color}20`, color: b.color, padding: "4px 12px", borderRadius: 6, fontFamily: mono, fontSize: 13, fontWeight: 700 }}>{b.name}</span>
            <span style={{ color: C.text, fontSize: 13, fontFamily: sans }}>{b.desc}</span>
          </div>
          <div style={{ padding: "10px 18px" }}>
            <div style={{ color: C.textDim, fontSize: 12, fontFamily: mono, marginBottom: 4 }}>Rules: <span style={{ color: C.text }}>{b.rules}</span></div>
            {b.mergeFrom && <div style={{ color: C.textDim, fontSize: 12, fontFamily: mono, marginBottom: 4 }}>Merges from: <span style={{ color: b.color }}>{b.mergeFrom}</span></div>}
            {b.example && <div style={{ color: C.textDim, fontSize: 12, fontFamily: mono }}>Examples: <span style={{ color: `${b.color}99` }}>{b.example}</span></div>}
          </div>
        </div>
      ))}

      {/* Protection rules */}
      <div style={{ background: `${C.red}08`, borderRadius: 12, padding: 20, border: `1px solid ${C.red}20` }}>
        <div style={{ color: C.red, fontSize: 13, fontFamily: mono, fontWeight: 700, letterSpacing: 1.5, marginBottom: 12 }}>BRANCH PROTECTION RULES (set in GitHub Settings)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { branch: "main", rule: "Require PR with 1 approval. Require CI to pass. No direct pushes. No force push." },
            { branch: "develop", rule: "Require CI to pass. Allow direct pushes from you (solo dev). Require PR from others." },
          ].map((r, i) => (
            <div key={i} style={{ color: C.text, fontSize: 12, fontFamily: mono }}>
              <span style={{ color: C.red, fontWeight: 700 }}>{r.branch}:</span> {r.rule}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Publish() {
  const sections = [
    {
      title: "WHAT GETS PUBLISHED TO NPM",
      color: C.green,
      items: [
        { item: "packages/cli", note: "Published as 'llm-observer' on npm. This is the ONLY package users install.", published: true },
        { item: "packages/proxy", note: "Bundled INTO cli during build. NOT published separately.", published: false },
        { item: "packages/database", note: "Bundled INTO cli during build. NOT published separately.", published: false },
        { item: "packages/dashboard", note: "Built and served by the CLI. NOT published separately.", published: false },
        { item: "apps/tauri", note: "Distributed as .dmg/.msi/.AppImage via GitHub Releases. NOT on npm.", published: false },
      ],
    },
    {
      title: "WHAT GETS PUSHED TO GITHUB (everything)",
      color: C.blue,
      items: [
        { item: "All packages/*", note: "Full monorepo with source code", published: true },
        { item: "apps/tauri", note: "Desktop app source (but not build artifacts)", published: true },
        { item: "README.md, LICENSE, CONTRIBUTING.md", note: "Essential repo files", published: true },
        { item: ".github/ workflows + templates", note: "CI/CD and issue templates", published: true },
        { item: "docs/", note: "Documentation and assets", published: true },
      ],
    },
    {
      title: "WHAT NEVER GETS COMMITTED",
      color: C.red,
      items: [
        { item: "node_modules/", note: "Dependencies — installed via npm install", published: false },
        { item: "dist/ build/", note: "Build artifacts — generated by npm run build", published: false },
        { item: ".env files", note: "Secrets — API keys, npm tokens", published: false },
        { item: "*.db files", note: "SQLite databases — user data", published: false },
        { item: "Tauri build outputs", note: ".dmg, .msi, .AppImage — distributed via GitHub Releases", published: false },
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* npm publish flow */}
      <div style={{ background: C.bgCard, borderRadius: 12, padding: 24, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.yellow, fontSize: 13, fontFamily: mono, fontWeight: 700, letterSpacing: 1.5, marginBottom: 14 }}>NPM PUBLISH FLOW</div>
        <pre style={{ color: C.text, fontFamily: mono, fontSize: 12, lineHeight: 2, margin: 0 }}>
{`1. Merge release branch → main
2. Create GitHub Release (tag: v1.0.0)
3. GitHub Action auto-triggers:
   → npm ci (install deps)
   → npm run build (build all packages)
   → cd packages/cli && npm publish
4. Users can now: npm install -g llm-observer@1.0.0`}
        </pre>
      </div>

      {/* Desktop release flow */}
      <div style={{ background: C.bgCard, borderRadius: 12, padding: 24, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.purple, fontSize: 13, fontFamily: mono, fontWeight: 700, letterSpacing: 1.5, marginBottom: 14 }}>DESKTOP RELEASE FLOW (Phase 2)</div>
        <pre style={{ color: C.text, fontFamily: mono, fontSize: 12, lineHeight: 2, margin: 0 }}>
{`1. Push tag: desktop-v1.0.0
2. GitHub Action auto-triggers:
   → Builds Tauri app on Mac, Windows, Linux (3 parallel jobs)
   → Uploads .dmg, .msi, .AppImage to GitHub Release
3. Users download from GitHub Releases page or your website`}
        </pre>
      </div>

      {sections.map((s, si) => (
        <div key={si} style={{ background: C.bgCard, borderRadius: 12, border: `1px solid ${s.color}20`, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${s.color}12`, color: s.color, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5 }}>{s.title}</div>
          {s.items.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: i < s.items.length - 1 ? `1px solid ${C.border}50` : "none" }}>
              <span style={{ color: item.published ? C.green : C.red, fontSize: 14 }}>{item.published ? "✓" : "✗"}</span>
              <span style={{ color: C.textBright, fontSize: 13, fontFamily: mono, fontWeight: 600, minWidth: 250 }}>{item.item}</span>
              <span style={{ color: C.textDim, fontSize: 12, fontFamily: mono }}>{item.note}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Commands() {
  const groups = [
    {
      title: "INITIAL SETUP (run these now)",
      color: C.green,
      commands: [
        { cmd: "git clone https://github.com/Ranjitbehera0034/llm-observer.git", desc: "Clone your empty repo" },
        { cmd: "cd llm-observer", desc: "" },
        { cmd: "git checkout -b develop", desc: "Create develop branch" },
        { cmd: "# Copy all the files I created into this directory", desc: "" },
        { cmd: "git add .", desc: "Stage everything" },
        { cmd: 'git commit -m "chore: initial project scaffolding"', desc: "First commit" },
        { cmd: "git push -u origin develop", desc: "Push develop branch" },
        { cmd: "git checkout main", desc: "Switch to main" },
        { cmd: "git merge develop", desc: "Bring main up to date" },
        { cmd: "git push -u origin main", desc: "Push main branch" },
      ],
    },
    {
      title: "DAILY WORKFLOW (feature development)",
      color: C.blue,
      commands: [
        { cmd: "git checkout develop", desc: "Start from develop" },
        { cmd: "git pull origin develop", desc: "Get latest" },
        { cmd: "git checkout -b feature/openai-provider", desc: "Create feature branch" },
        { cmd: "# ... write code, commit often ...", desc: "" },
        { cmd: 'git add . && git commit -m "feat: add OpenAI provider"', desc: "Commit with conventional message" },
        { cmd: "git push -u origin feature/openai-provider", desc: "Push feature branch" },
        { cmd: "# Open PR on GitHub: feature/openai-provider → develop", desc: "" },
        { cmd: "# After PR merged, delete feature branch:", desc: "" },
        { cmd: "git checkout develop && git pull", desc: "Update local develop" },
        { cmd: "git branch -d feature/openai-provider", desc: "Delete local feature branch" },
      ],
    },
    {
      title: "RELEASE WORKFLOW (when ready to publish)",
      color: C.yellow,
      commands: [
        { cmd: "git checkout develop && git pull", desc: "Start from latest develop" },
        { cmd: "git checkout -b release/v1.0.0", desc: "Create release branch" },
        { cmd: "# Bump version in packages/cli/package.json", desc: "" },
        { cmd: "# Update CHANGELOG.md", desc: "" },
        { cmd: "# Final testing", desc: "" },
        { cmd: 'git commit -am "chore: bump version to 1.0.0"', desc: "" },
        { cmd: "git checkout main && git merge release/v1.0.0", desc: "Merge to main" },
        { cmd: "git tag v1.0.0", desc: "Tag the release" },
        { cmd: "git push origin main --tags", desc: "Push main + tag" },
        { cmd: "# Create GitHub Release from tag → triggers npm publish", desc: "" },
        { cmd: "git checkout develop && git merge main", desc: "Sync develop with main" },
        { cmd: "git push origin develop", desc: "" },
        { cmd: "git branch -d release/v1.0.0", desc: "Delete release branch" },
      ],
    },
    {
      title: "HOTFIX WORKFLOW (critical production bug)",
      color: C.red,
      commands: [
        { cmd: "git checkout main", desc: "Start from main (production)" },
        { cmd: "git checkout -b hotfix/kill-switch-bypass", desc: "Create hotfix branch" },
        { cmd: "# Fix the bug", desc: "" },
        { cmd: 'git commit -am "fix: prevent kill switch bypass on streaming"', desc: "" },
        { cmd: "git checkout main && git merge hotfix/kill-switch-bypass", desc: "Merge to main" },
        { cmd: "git tag v1.0.1", desc: "Patch version" },
        { cmd: "git push origin main --tags", desc: "Push + trigger release" },
        { cmd: "git checkout develop && git merge main", desc: "Also merge to develop" },
        { cmd: "git push origin develop", desc: "" },
        { cmd: "git branch -d hotfix/kill-switch-bypass", desc: "Cleanup" },
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {groups.map((g, gi) => (
        <div key={gi} style={{ background: C.bgCard, borderRadius: 12, border: `1px solid ${g.color}20`, overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${g.color}12`, color: g.color, fontSize: 13, fontWeight: 700, fontFamily: mono, letterSpacing: 1.5 }}>{g.title}</div>
          <div style={{ padding: "8px 0" }}>
            {g.commands.map((c, i) => (
              <div key={i} style={{ padding: "5px 18px", display: "flex", alignItems: "center", gap: 8 }}>
                {c.cmd.startsWith("#") ? (
                  <span style={{ color: C.textDim, fontSize: 12, fontFamily: mono, fontStyle: "italic" }}>{c.cmd}</span>
                ) : (
                  <>
                    <span style={{ color: g.color, fontSize: 12, fontFamily: mono }}>$</span>
                    <span style={{ color: C.textBright, fontSize: 12, fontFamily: mono }}>{c.cmd}</span>
                  </>
                )}
                {c.desc && <span style={{ color: C.textDim, fontSize: 11, fontFamily: mono, marginLeft: "auto" }}>{c.desc}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilesCreated() {
  const files = [
    { file: "README.md", status: "Created", desc: "Your landing page — hero section, quick start, features, pricing, roadmap" },
    { file: ".gitignore", status: "Created", desc: "Ignores node_modules, dist, .env, .db, OS files, Tauri builds" },
    { file: "LICENSE", status: "Created", desc: "MIT License — standard for open-source dev tools" },
    { file: "CONTRIBUTING.md", status: "Created", desc: "Setup guide, PR process, commit conventions, code style" },
    { file: "package.json", status: "Created", desc: "Root monorepo config with npm workspaces" },
    { file: "tsconfig.base.json", status: "Created", desc: "Shared TypeScript config — strict mode, ES2022 target" },
    { file: ".npmrc", status: "Created", desc: "npm config — engine-strict, save-exact" },
    { file: ".github/workflows/ci.yml", status: "Created", desc: "CI — lint, typecheck, test, build on every PR (Node 18/20/22)" },
    { file: ".github/workflows/publish.yml", status: "Created", desc: "Auto-publish to npm when you create a GitHub Release" },
    { file: ".github/workflows/desktop-release.yml", status: "Created", desc: "Build Tauri desktop app for Mac/Win/Linux on tag push" },
    { file: ".github/ISSUE_TEMPLATE/bug_report.md", status: "Created", desc: "Structured bug report template" },
    { file: ".github/ISSUE_TEMPLATE/feature_request.md", status: "Created", desc: "Feature request template" },
    { file: "Full directory structure with .gitkeep files", status: "Created", desc: "All folders for proxy, database, dashboard, cli, tauri, docs" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ background: `${C.green}08`, borderRadius: 12, padding: "14px 18px", border: `1px solid ${C.green}20` }}>
        <div style={{ color: C.green, fontSize: 14, fontFamily: sans, fontWeight: 600 }}>
          All these files are ready to download and push to your repo. They form the complete scaffolding for your project.
        </div>
      </div>
      <div style={{ background: C.bgCard, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {files.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: i < files.length - 1 ? `1px solid ${C.border}50` : "none" }}>
            <span style={{ color: C.green, fontSize: 13 }}>✓</span>
            <span style={{ color: C.cyan, fontFamily: mono, fontSize: 12, fontWeight: 600, minWidth: 300 }}>{f.file}</span>
            <span style={{ color: C.textDim, fontSize: 12, fontFamily: mono }}>{f.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState("structure");

  const render = () => {
    switch (active) {
      case "structure": return <Structure />;
      case "branching": return <Branching />;
      case "publish": return <Publish />;
      case "commands": return <Commands />;
      case "files": return <FilesCreated />;
      default: return <Structure />;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: sans }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ padding: "20px 24px 0", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${C.green}, #1a6b44)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: `0 0 20px rgba(61,255,160,0.15)` }}>⬡</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.textBright, fontFamily: mono }}>LLM Observer — Repo Setup Guide</div>
            <div style={{ fontSize: 12, color: C.textDim, fontFamily: mono }}>Structure · Branching · Publishing · CI/CD</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setActive(t.id)} style={{
              padding: "10px 16px", background: active === t.id ? "#0f1822" : "transparent",
              border: "none", borderBottom: active === t.id ? `2px solid ${C.green}` : "2px solid transparent",
              color: active === t.id ? C.green : C.textDim, fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: mono, borderRadius: "6px 6px 0 0", transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>{render()}</div>
    </div>
  );
}
