import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { getDbPath } from '@llm-observer/database';

export const setupResetCommands = (program: Command) => {
  program
    .command('reset')
    .description('Reset LLM Observer (deletes local database and logs)')
    .option('-f, --force', 'Force reset without confirmation')
    .action(async (options) => {
      const dbPath = getDbPath();
      const dbDir = path.dirname(dbPath);

      if (!options.force) {
        console.log(chalk.yellow(`⚠️  WARNING: This will delete your local database at ${dbPath}`));
        console.log(chalk.yellow('All historical data, budgets, and settings will be lost.'));
        // In a real CLI we would use an inquirer prompt here, 
        // but for this implementation we'll assume the user knows what they're doing or use --force.
        console.log(chalk.gray('To confirm, run with --force or manually delete the file.'));
        return;
      }

      try {
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
            console.log(chalk.green('✔ Database deleted successfully.'));
        } else {
            console.log(chalk.gray('Database file not found. Nothing to reset.'));
        }

        // Also clear any logs if they exist
        const logPath = path.join(dbDir, 'logs');
        if (fs.existsSync(logPath)) {
            fs.rmSync(logPath, { recursive: true, force: true });
            console.log(chalk.green('✔ Logs cleared.'));
        }

        console.log(chalk.blue('\nLLM Observer has been reset. Run "llm-observer start" to initialize a fresh instance.'));
      } catch (err: any) {
        console.error(chalk.red(`Failed to reset: ${err.message}`));
      }
    });
};
