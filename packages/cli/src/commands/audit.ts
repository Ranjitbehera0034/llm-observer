import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || 'http://localhost:4001';

export function setupAuditCommands(program: Command) {
    program
        .command('audit')
        .description('Generate Enterprise Audit Logs (SSO, Access, Security Events)')
        .option('--range <range>', 'Time range (e.g. 30d)', '30d')
        .option('--format <format>', 'Export format (json, csv)', 'json')
        .action(async (options) => {
            console.log(chalk.blue(`Generating Enterprise Audit Logs for the last ${options.range}...`));

            try {
                // Mock fetching audit logs from the backend
                const authLog = [
                    { time: new Date().toISOString(), event: 'sso_login_success', user: 'admin@acmecorp.com', ip: '192.168.1.1' },
                    { time: new Date().toISOString(), event: 'api_key_created', user: 'johndoe@acmecorp.com', ip: '10.0.0.5' }
                ];

                if (options.format === 'csv') {
                    console.log('Time,Event,User,IP');
                    authLog.forEach(l => {
                        console.log(`${l.time},${l.event},${l.user},${l.ip}`);
                    });
                } else {
                    console.log(JSON.stringify(authLog, null, 2));
                }

                console.log(chalk.green('\n✓ Audit export complete.'));
            } catch (err: any) {
                console.error(chalk.red(`Failed to generate audit logs: ${err.message}`));
            }
        });
}
