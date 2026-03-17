/**
 * k6 Load Test — LLM Observer Proxy Engine
 *
 * Tests the proxy under realistic LLM request patterns.
 * Runs three stages: ramp up, sustain at peak, ramp down.
 *
 * Usage:
 *   k6 run tests/load/k6-proxy-load.js
 *   k6 run --vus 200 --duration 60s tests/load/k6-proxy-load.js
 *
 * Install k6: brew install k6
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Custom Metrics ───────────────────────────────────────────────────────────
const errorRate = new Rate('error_rate');
const proxyLatency = new Trend('proxy_latency_ms', true);
const successfulRequests = new Counter('successful_requests');

// ─── Test Configuration ───────────────────────────────────────────────────────
export const options = {
    stages: [
        { duration: '15s', target: 20 },   // Ramp: 0 → 20 VUs
        { duration: '30s', target: 100 },  // Ramp: 20 → 100 VUs (peak load)
        { duration: '30s', target: 100 },  // Sustain at 100 VUs
        { duration: '15s', target: 0 },    // Ramp down cleanly
    ],
    thresholds: {
        // 95th percentile latency must be under 2 seconds
        http_req_duration: ['p(95)<2000'],
        // Error rate must stay below 1%
        error_rate: ['rate<0.01'],
        // Less than 2% of requests should time out
        http_req_failed: ['rate<0.02'],
    },
};

const PROXY_BASE = __ENV.PROXY_URL || 'http://localhost:4000';

// Simulated OpenAI-style chat completion request body
const FAKE_OPENAI_BODY = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2 + 2?' }
    ],
    max_tokens: 10,
    stream: false,
});

const headers = {
    'Content-Type': 'application/json',
    // Use a fake key — the proxy will forward it, and the upstream will reject it.
    // We're testing proxy throughput, NOT upstream response.
    'Authorization': 'Bearer sk-test-loadtest-key-not-real',
    'x-llm-observer-project': 'load-test',
};

// ─── Scenario 1: Health check (lightweight, high frequency) ──────────────────
function testHealth() {
    const res = http.get(`${PROXY_BASE}/health`);
    const ok = check(res, {
        'health status is ok': (r) => r.status === 200,
        'health response time < 100ms': (r) => r.timings.duration < 100,
    });
    errorRate.add(!ok);
    proxyLatency.add(res.timings.duration);
    if (ok) successfulRequests.add(1);
}

// ─── Scenario 2: Proxy request (heavy, realistic LLM call) ───────────────────
function testProxyRequest() {
    const res = http.post(
        `${PROXY_BASE}/v1/openai/chat/completions`,
        FAKE_OPENAI_BODY,
        { headers, timeout: '10s' }
    );

    // We expect: 200 (real key), 401 (auth rejected by upstream), or 402 (budget exceeded)
    // All of these mean the PROXY handled the request without crashing.
    const proxyWorked = check(res, {
        'proxy did not crash (status != 500)': (r) => r.status !== 500,
        'proxy did not crash (status != 502)': (r) => r.status !== 502,
        'proxy response time < 5s': (r) => r.timings.duration < 5000,
    });

    errorRate.add(!proxyWorked);
    proxyLatency.add(res.timings.duration);
    if (proxyWorked) successfulRequests.add(1);
}

// ─── Scenario 3: Dashboard API stats (read-heavy) ─────────────────────────────
function testDashboardApi() {
    const res = http.get(`http://localhost:4001/api/stats/overview?projectId=default`);
    const ok = check(res, {
        'dashboard api returns 200': (r) => r.status === 200,
        'dashboard api < 200ms': (r) => r.timings.duration < 200,
    });
    errorRate.add(!ok);
    proxyLatency.add(res.timings.duration);
    if (ok) successfulRequests.add(1);
}

// ─── Main VU function ─────────────────────────────────────────────────────────
export default function () {
    const scenario = Math.random();

    if (scenario < 0.2) {
        // 20% of VUs: health checks (light traffic)
        testHealth();
    } else if (scenario < 0.7) {
        // 50% of VUs: proxy requests (core load)
        testProxyRequest();
    } else {
        // 30% of VUs: dashboard API reads
        testDashboardApi();
    }

    // Realistic think time between requests (0.5 - 2s)
    sleep(0.5 + Math.random() * 1.5);
}

// ─── Summary Hook ─────────────────────────────────────────────────────────────
export function handleSummary(data) {
    console.log('\n=== LLM Observer Proxy Load Test Summary ===');
    return {
        'tests/load/results/k6-summary.json': JSON.stringify(data, null, 2),
        stdout: '\n' + JSON.stringify(data.metrics['error_rate'], null, 2),
    };
}
