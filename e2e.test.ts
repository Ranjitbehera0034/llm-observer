import { spawn } from 'child_process';

console.log('Starting E2E Validation Test Runner...');

async function run() {
    console.log('Spawning LLM Observer stack...');
    const child = spawn('npm', ['run', 'dev:all'], {
        stdio: 'ignore', // Keep silent
        shell: true
    });

    console.log('Waiting 5 seconds for servers to initialize...');
    await new Promise(r => setTimeout(r, 5000));

    console.log('Testing Proxy /health endpoint...');
    try {
        const res = await fetch('http://localhost:4000/health');
        const data = await res.json();
        console.log('Proxy Health Response:', data);

        if (data.status === 'ok') {
            console.log('✅ End-to-end proxy test passed!');
        } else {
            console.error('❌ End-to-end proxy test failed!');
            process.exit(1);
        }

        console.log('Testing Dashboard port 4001 reachability...');
        const uiReq = await fetch('http://localhost:4001');
        if (uiReq.ok) {
            console.log('✅ End-to-end Dashboard fallback UI test passed!');
        }
    } catch (err: any) {
        console.error('❌ End-to-end test failed to connect:', err.message);
        process.exit(1);
    } finally {
        console.log('Tearing down E2E test nodes...');
        child.kill('SIGINT');
        process.exit(0);
    }
}

run();
