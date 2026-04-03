import { runOptimizationEngine } from './engine';
import { getDb } from '@llm-observer/database';

async function testThresholdEnforcement() {
    const db = getDb();
    
    // 1. Setup minimal data (3 days)
    console.log('Seeding 3 days of data...');
    db.prepare('DELETE FROM usage_records').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM optimization_cache').run();

    const now = new Date();
    for (let i = 0; i < 3; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        db.prepare(`
            INSERT INTO usage_records (bucket_start, provider, model, cost_usd, num_requests, input_tokens, output_tokens)
            VALUES (?, 'openai', 'gpt-4o', 1.5, 10, 1000, 500)
        `).run(date.toISOString());
    }

    // 2. Run engine
    console.log('Running engine on 3 days of data...');
    const result = await runOptimizationEngine(30, false); // No cache

    // 3. Verify
    console.log(`Engine Score: ${result.score}`);
    console.log(`Rules Fired: ${result.results.length}`);
    
    // Most rules require 7-14 days. If minDataDays is enforced, results should be very low or Zero.
    const ruleIds = result.results.map(r => r.ruleId);
    console.log('Fired Rule IDs:', ruleIds);

    const hasLongTermRules = result.results.some(r => {
       // We know some rules like 'model-downgrade-simple-tasks' usually need 7 days
       return r.ruleId === 'model-downgrade-simple-tasks'; 
    });

    if (hasLongTermRules) {
        console.error('FAIL: Rules requiring >3 days fired on 3 days of data!');
        process.exit(1);
    } else {
        console.log('SUCCESS: No long-term rules fired on sparse data.');
    }
}

testThresholdEnforcement().catch(console.error);
