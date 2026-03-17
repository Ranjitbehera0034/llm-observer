import { Command } from 'commander';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { syncPricingToDb, addCustomPricing } from '@llm-observer/database';
import path from 'path';

// Just a placeholder URL. In reality, you'd host a pricing.json file somewhere like GitHub Pages.
// For the sake of this prompt, we can fallback to the seed data locally.
const PRICING_URL = 'https://raw.githubusercontent.com/run-llama/llm-observer/main/pricing.json';

export function setupPricingCommands(program: Command) {
    const pricingCmd = program.command('pricing').description('Manage LLM pricing data');

    pricingCmd
        .command('update')
        .description('Update pricing from remote registry')
        .action(async () => {
            console.log(chalk.blue(`Fetching latest pricing data...\\n`));

            try {
                let newPricing = [];
                try {
                    const res = await fetch(PRICING_URL);
                    if (res.ok) {
                        newPricing = await res.json() as any[];
                    } else {
                        throw new Error('Remote URL returned ' + res.status);
                    }
                } catch (e: any) {
                    console.log(chalk.yellow(`Could not fetch remote pricing (${e.message}). Falling back to local seed data...`));
                    const { getInitialPricing } = require('@llm-observer/database');
                    newPricing = getInitialPricing();
                }

                syncPricingToDb(newPricing);
                console.log(chalk.green(`Successfully updated pricing for ${newPricing.length} models.`));

            } catch (err: any) {
                console.error(chalk.red(`Failed to update pricing: ${err.message}`));
            }
        });

    pricingCmd
        .command('add')
        .description('Add custom pricing for a model')
        .requiredOption('--provider <provider>', 'Provider name (e.g. openai)')
        .requiredOption('--model <model>', 'Model name (e.g. gpt-custom)')
        .requiredOption('--input <rate>', 'Input cost per 1M tokens', parseFloat)
        .requiredOption('--output <rate>', 'Output cost per 1M tokens', parseFloat)
        .option('--cached <rate>', 'Cached input cost per 1M tokens', parseFloat)
        .action((options) => {
            try {
                addCustomPricing({
                    provider: options.provider,
                    model: options.model,
                    input: options.input,
                    output: options.output,
                    cached: options.cached || null
                });
                console.log(chalk.green(`Successfully added custom pricing for ${options.provider}:${options.model}`));
            } catch (err: any) {
                console.error(chalk.red(`Failed to add custom pricing: ${err.message}`));
            }
        });
}
