#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { setupStatusCommands } from './commands/status';
import { setupProjectsCommands } from './commands/projects';
import { setupLogsCommands } from './commands/logs';

const program = new Command();

program
  .name('llm-observe')
  .description('CLI Management Tool for LLM Observer Proxy & Dashboard')
  .version('1.0.0');

// Register modular commands
setupStatusCommands(program);
setupProjectsCommands(program);
setupLogsCommands(program);

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
