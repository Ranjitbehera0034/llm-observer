import { Command } from 'commander';
import chalk from 'chalk';
import { getDb } from '@llm-observer/database';

export function setupTeamCommands(program: Command) {
    const team = program.command('team').description('Manage team cloud synchronization');

    team
        .command('join <apiKey>')
        .description('Join a team using an API key')
        .option('--email <email>', 'Contributor email address')
        .action(async () => {
            console.error(chalk.yellow('Team joining is not available in this beta. No membership was created or sync enabled.'));
            process.exitCode = 1;
        });

    team
        .command('status')
        .description('Check team sync status')
        .action(() => {
            const db = getDb();
            const getSetting = (key: string) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;

            const teamApiKey = getSetting('team_api_key')?.value;
            const syncEnabled = getSetting('team_sync_enabled')?.value === 'true';
            const lastSync = getSetting('last_team_sync_at')?.value;

            if (!teamApiKey) {
                console.log(chalk.yellow('No team configuration. Team joining is not available in this beta.'));
                return;
            }

            console.log(chalk.bold('Saved Team Configuration (membership not verified):'));
            console.log(`- Status: ${syncEnabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
            console.log(`- Last Sync: ${lastSync ? chalk.blue(new Date(lastSync).toLocaleString()) : chalk.gray('Never')}`);
            console.log(`- Member: ${getSetting('team_member_email')?.value || 'N/A'}`);
        });

    team
        .command('sync')
        .description('Trigger manual data push to team cloud')
        .action(async () => {
            console.error(chalk.yellow('Manual team sync is not available in this beta. No data was sent.'));
            process.exitCode = 1;
        });
}
