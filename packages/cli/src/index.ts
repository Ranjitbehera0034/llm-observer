#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { setupStatusCommands } from './commands/status';
import { setupProjectsCommands } from './commands/projects';
import { setupLogsCommands } from './commands/logs';
import { setupStartCommands } from './commands/start';
import { setupStatsCommands } from './commands/stats';
import { setupBudgetCommands } from './commands/budget';
import { setupConfigCommands } from './commands/config';
import { setupExportCommands } from './commands/export';
import { setupStopCommands } from './commands/stop';
import { setupPricingCommands } from './commands/pricing';
import { setupAuditCommands } from './commands/audit';
import { setupBillingCommands } from './commands/billing';
import { setupStressCommands } from './commands/stress';
import { initDb } from '@llm-observer/database';

initDb();

const banner = `
${chalk.bold.blue('  _      _      __  __    ____  _                              ')}
${chalk.bold.blue(' | |    | |    |  \\/  |  / __ \\| |                             ')}
${chalk.bold.blue(' | |    | |    | \\  / | | |  | | |__  ___  ___ _ ____   ___ __ ')}
${chalk.bold.blue(' | |    | |    | |\\/| | | |  | | \'_ \\/ __|/ _ \\ \'__\\ \\ / / \'__|')}
${chalk.bold.blue(' | |____| |____| |  | | | |__| | |_) \\__ \\  __/ |   \\ V /| |   ')}
${chalk.bold.blue(' |______|______|_|  |_|  \\____/|_.__/|___/\\___|_|    \\_/ |_|   ')}
`;

console.log(banner);

const program = new Command();

program
  .name('llm-observer')
  .description('CLI Management Tool for LLM Observer Proxy & Dashboard')
  .version('1.0.0');

// Register modular commands
setupStatusCommands(program);
setupProjectsCommands(program);
setupLogsCommands(program);
setupStartCommands(program);
setupStatsCommands(program);
setupBudgetCommands(program);
setupConfigCommands(program);
setupExportCommands(program);
setupStopCommands(program);
setupPricingCommands(program);
setupAuditCommands(program);
setupBillingCommands(program);
setupStressCommands(program);

// Handle unknown commands
program.on('command:*', function (operands) {
  console.error(chalk.red(`error: unknown command '${operands[0]}'`));
  const availableCommands = program.commands.map((cmd: Command) => cmd.name());
  console.log(chalk.gray(`Available commands: ${availableCommands.join(', ')}`));
  process.exit(1);
});

// Parse arguments
program.parse(process.argv);

// If no args, output help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
