import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';

const PROXY_URL = process.env.PROXY_URL || 'http://localhost:4000';

export function setupStressCommands(program: Command) {
    program
        .command('stress')
        .description('Perform End-to-End stress tests generating proxy traffic volume')
        .option('--count <count>', 'Number of requests to fire', '50')
        .action(async (options) => {
            const count = parseInt(options.count, 10);
            console.log(chalk.blue(`Initiating End-to-End Stress Test: Firing ${count} parallel requests to local proxy...`));

            const start = Date.now();
            let success = 0;
            let failed = 0;

            const payload = {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'Say "Stress Test!"' }]
            };

            const promises = Array.from({ length: count }).map(() => {
                return fetch(`${PROXY_URL}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer test_key'
                    },
                    body: JSON.stringify(payload)
                }).then(res => {
                    if (res.ok) success++;
                    else failed++;
                }).catch(() => failed++);
            });

            await Promise.allSettled(promises);
            const duration = Date.now() - start;

            console.log(chalk.green(`\n✓ Stress Test Completed in ${duration}ms!`));
            console.log(chalk.gray(`  - Successful: ${success}`));

            if (failed > 0) {
                console.log(chalk.red(`  - Failed: ${failed}`));
            }
        });
}
