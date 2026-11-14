// Repeatable release audit: isolated data, no imports of personal session logs.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-observer-perf-'));
const output = path.resolve('docs/qa/resource-audit.json');
const log = fs.openSync(path.join(data, 'server.log'), 'w');
const server = spawn(process.execPath, ['packages/proxy/dist/server.js'], {
  env: { ...process.env, LLM_OBSERVER_DATA_DIR: data, LLM_OBSERVER_DISABLE_PARSERS: '1', LLM_OBSERVER_PORT: '4911', LLM_OBSERVER_PROXY_PORT: '4910' },
  stdio: ['ignore', log, log]
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const samples = [];
function sample(phase) {
  const raw = execFileSync('ps', ['-p', String(server.pid), '-o', '%cpu=,rss=']).toString().trim().split(/\s+/).map(Number);
  samples.push({ phase, at: new Date().toISOString(), cpuPercent: raw[0], rssMiB: raw[1] / 1024 });
}
(async () => {
  const start = performance.now();
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch('http://127.0.0.1:4911/api/license/status', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  if (!ready) throw new Error('Server did not become ready');
  const startupMs = performance.now() - start;
  // Let startup pricing refresh settle. Measure short idle separately from load.
  for (let n = 0; n < 12; n++) { await delay(5000); sample('idle'); }
  const db = new (require('better-sqlite3'))(path.join(data, 'data.db'));
  const insert = db.prepare('INSERT INTO sessions (session_id, provider, project_path, model_primary, started_at, ended_at, input_tokens, output_tokens, estimated_cost_usd, tool_calls_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => { for (let i = 0; i < 10000; i++) insert.run('qa-'+i, 'claude-code', '/synthetic/project-'+(i%20), 'claude-sonnet-4-20250514', new Date().toISOString(), new Date().toISOString(), 1000, 100, .0045, '{"Read":3,"Bash":1}'); })();
  db.close();
  const latencies = [], failures = [];
  const endpoints = ['/api/sessions?limit=50', '/api/sessions/summary', '/api/sessions/by-project', '/api/sessions/expensive?limit=3', '/api/overview?period=month', '/api/overview/timeline?days=30', '/api/license/status'];
  for (let n = 0; n < 30; n++) {
    await Promise.all(endpoints.map(async endpoint => {
      const t = performance.now();
      try { const r = await fetch('http://127.0.0.1:4911'+endpoint, { signal: AbortSignal.timeout(10000) }); await r.text(); if (!r.ok) failures.push({ endpoint, status: r.status }); }
      catch (error) { failures.push({ endpoint, error: error.message }); }
      latencies.push(performance.now()-t);
    }));
    sample('loaded');
  }
  for (let n = 0; n < 6; n++) { await delay(5000); sample('recovery'); }
  latencies.sort((a,b)=>a-b);
  const result = { timestamp: new Date().toISOString(), platform: `${os.platform()} ${os.arch()}`, node: process.version, dataDirectory: data, scope: 'Backend only; synthetic 10,000 sessions; personal imports disabled; no provider keys; 60-second idle + API burst + 30-second recovery. Not a battery-life measurement.', startupMs, requests: latencies.length, failures, p50Ms: latencies[Math.floor(latencies.length*.5)], p95Ms: latencies[Math.floor(latencies.length*.95)], maxMs: latencies.at(-1), samples };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({ output, startupMs, requests: result.requests, failures: failures.length, p95Ms: result.p95Ms, maxRssMiB: Math.max(...samples.map(s=>s.rssMiB)) }));
  if (failures.length) process.exitCode=1;
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(()=>{ server.kill('SIGTERM'); fs.closeSync(log); });
