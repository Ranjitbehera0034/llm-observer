# Testing Infrastructure

This directory contains all testing layers for LLM Observer.

```
tests/
├── load/                   # Layer 1: Proxy Load & Stress Testing
│   ├── k6-proxy-load.js    # k6 script (100 VUs, 3-stage ramp)
│   ├── artillery-proxy.yml # Artillery alternative (npm script)
│   └── results/            # Output saved here
│
├── e2e/                    # Layer 2: React Dashboard E2E
│   ├── dashboard.spec.ts   # Navigation, Settings, API Keys
│   └── payment-flow.spec.ts# Geo-payment flow (mocked ipapi.co)
│
├── integration/            # Layer 3: Backend API Integration
│   └── api.test.ts         # Vitest + Supertest (all major routes)
│
└── bruno/                  # Visual API Client (like Postman)
    ├── bruno.json
    ├── environments/
    │   └── local.bru       # localhost:4000 / 4001
    ├── proxy/
    │   └── health-check.bru
    └── dashboard/
        ├── license-status.bru
        ├── activate-license.bru
        ├── stats-overview.bru
        ├── razorpay-webhook.bru
        └── lemonsqueezy-webhook.bru
```

---

## Quick Start

### Layer 1: Load Testing

**k6** (recommended, beautiful terminal output):
```bash
brew install k6
npm run test:load:k6
# or with custom VUs:
k6 run --vus 200 --duration 60s tests/load/k6-proxy-load.js
```

**Artillery** (npm-native):
```bash
npm install -g artillery
npm run test:load:artillery
```

### Layer 2: E2E Tests (Playwright)

```bash
# One-time browser install:
npx playwright install chromium

# Run all E2E specs (requires dev server running):
npm run test:e2e

# Visual UI mode (great for debugging):
npm run test:e2e:ui
```

### Layer 3: Integration Tests (Vitest + Supertest)

No servers needed — runs entirely in-memory:
```bash
npm run test:unit

# Watch mode during development:
npm run test:unit:watch

# With coverage report:
npm run test:unit:coverage
```

### Bruno API Client

1. Install: [usebruno.com](https://www.usebruno.com/)
2. Open Bruno → **Open Collection** → select `tests/bruno/`
3. Switch environment to **local**
4. Run requests or entire collections

---

## CI Integration

Add to your GitHub Actions workflow:

```yaml
- name: Run Integration Tests
  run: npm run test:unit

- name: Run E2E Tests
  run: |
    npx playwright install --with-deps chromium
    npm run dev:all &
    sleep 5
    npm run test:e2e
```

> Load tests (`k6` / `artillery`) are intentionally excluded from CI 
> to avoid rate-limiting issues. Run them locally before major releases.
