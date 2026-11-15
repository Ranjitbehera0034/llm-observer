import { Command } from 'commander';
export function setupUpgradeCommands(program: Command) {
    program.command('upgrade').description('Show Pro pricing and activation instructions').action(() => {
        console.log('Pro: $9/month or $79/year. 100 projects and 90-day request retention.');
        console.log('Plans and available payment methods: https://www.llm-observer.com/#pricing');
        console.log('After purchase: llm-observer activate <key>');
        console.log('Keep the purchase email to recover your key or set up a new device.');
    });
}
