import { Command } from 'commander';
import chalk from 'chalk';
import { updateBudget, getProject } from '@llm-observer/database';

export function setupBudgetCommands(program: Command) {
    program
        .command('budget')
        .description('Manage project budgets e.g. budget set 50 --daily')
        .argument('<action>', 'Action to perform (e.g. set)')
        .argument('<amount>', 'Budget amount')
        .option('--daily', 'Set daily budget')
        .option('--project <projectId>', 'Project ID', 'default')
        .action(async (action: string, amount: string, options: any) => {
            if (action !== 'set') {
                console.error(chalk.red(`Unsupported action: ${action}`));
                return;
            }

            console.log(chalk.blue(`Setting budget to $${amount} for project '${options.project}'...\\n`));
            try {
                const project = getProject(options.project);
                if (!project) {
                    console.error(chalk.red(`Project '${options.project}' not found.`));
                    return;
                }

                const body: any = {};
                if (options.daily) body.daily = parseFloat(amount);

                updateBudget(options.project, body);

                console.log(chalk.green(`Successfully updated budget.`));
            } catch (err: any) {
                console.error(chalk.red(`Error updating budget: ${err.message}`));
            }
        });
}
