import { Command } from 'commander';
import { setupStatsCommands } from '../commands/stats';
import { setupStatusCommands } from '../commands/status';

describe('CLI Command Registration', () => {
    let program: Command;

    beforeEach(() => {
        program = new Command();
    });

    it('registers stats command', () => {
        setupStatsCommands(program);
        const cmd = program.commands.find(c => c.name() === 'stats');
        expect(cmd).toBeDefined();
    });

    it('registers status command', () => {
        setupStatusCommands(program);
        const cmd = program.commands.find(c => c.name() === 'status');
        expect(cmd).toBeDefined();
    });

    it('displays help for each command', () => {
        setupStatsCommands(program);
        const cmd = program.commands.find(c => c.name() === 'stats');
        expect(cmd?.helpInformation()).toContain('stats');
    });
});
