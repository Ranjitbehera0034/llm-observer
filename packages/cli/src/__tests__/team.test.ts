import { Command } from 'commander';
import { setupTeamCommands } from '../commands/team';
import { getDb } from '@llm-observer/database';

jest.mock('@llm-observer/database', () => ({ getDb: jest.fn() }));

describe('Unreleased team operations', () => {
    const originalExitCode = process.exitCode;
    afterEach(() => { process.exitCode = originalExitCode; jest.restoreAllMocks(); });
    it.each([['join', 'secret', '--email', 'test@example.com'], ['sync']])('rejects %s without writing credentials or claiming success', async (...args) => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const program = new Command();
        setupTeamCommands(program);
        await program.parseAsync(['team', ...args], { from: 'user' });
        expect(process.exitCode).toBe(1);
        expect(getDb).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
    });
});
