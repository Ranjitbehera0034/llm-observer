import { Command } from 'commander';
import chalk from 'chalk';
import { getDb } from '@llm-observer/database';
import fetch from 'node-fetch';

export function setupTeamCommands(program: Command) {
    const team = program.command('team').description('Manage team cloud synchronization');

    team
        .command('join <apiKey>')
        .description('Join a team using an API key')
        .option('--email <email>', 'Contributor email address')
        .action(async (apiKey, options) => {
            const db = getDb();
            const email = options.email;

            if (!email) {
                console.error(chalk.red('Error: --email <email> is required to join a team.'));
                process.exit(1);
            }

            console.log(chalk.blue(`Joining team with API key: ${apiKey.substring(0, 8)}...`));

            // 1. Verify API key with team server (MVP: fetch team info)
            try {
                // We'll use a placeholder for now as we haven't built the "Get Team Info" endpoint yet
                // In a real app, this would validate the key and return team details.

                // 2. Save settings to SQLite
                const upsertSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");

                upsertSetting.run('team_api_key', apiKey);
                upsertSetting.run('team_member_email', email);
                upsertSetting.run('team_sync_enabled', 'true');
                upsertSetting.run('team_id', 'team_' + Math.random().toString(36).substring(7)); // Placeholder

                console.log(chalk.green('Successfully joined team!'));
                console.log(chalk.gray('Background sync is now enabled. Your aggregated stats will be pushed every 15 minutes.'));
            } catch (err) {
                console.error(chalk.red('Failed to join team:'), err);
            }
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
                console.log(chalk.yellow('Not joined to any team. Run `llm-observer team join <key>` to start syncing.'));
                return;
            }

            console.log(chalk.bold('Team Sync Status:'));
            console.log(`- Status: ${syncEnabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
            console.log(`- Last Sync: ${lastSync ? chalk.blue(new Date(lastSync).toLocaleString()) : chalk.gray('Never')}`);
            console.log(`- Member: ${getSetting('team_member_email')?.value || 'N/A'}`);
        });

    team
        .command('sync')
        .description('Trigger manual data push to team cloud')
        .action(async () => {
            console.log(chalk.blue('Triggering manual sync...'));
            // In a real app, we'd notify the running proxy process or just run the sync logic here.
            // For now, we'll advise the user that sync happens automatically in the proxy.
            console.log(chalk.gray('Note: Sync is handled by the running proxy process. Ensure the proxy is running.'));
        });
}
