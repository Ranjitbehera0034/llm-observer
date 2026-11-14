import { Command } from 'commander';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { syncPricingToDb, addCustomPricing } from '@llm-observer/database';


const PRICING_URL = 'https://raw.githubusercontent.com/Ranjitbehera0034/llm-observer/main/pricing.json';

export function setupPricingCommands(program: Command) {
    const pricingCmd = program.command('pricing').description('Manage LLM pricing data');

    pricingCmd
        .command('update')
        .description('Update pricing from remote registry')
        .action(async () => {
            console.log(chalk.blue(`Fetching latest pricing data...\\n`));

            try {
                const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(8000) as any, size: 2_000_000 });
                if (!res.ok) throw new Error(`Registry returned ${res.status}; existing prices preserved`);
                const raw = await res.json() as any[];
                if (!Array.isArray(raw)) throw new Error('Invalid pricing catalog');
                const newPricing = raw.map(item => ({provider:item.provider,model:item.model,input:item.input ?? item.input_cost_per_1m,output:item.output ?? item.output_cost_per_1m,cached:item.cached ?? item.cached_input_cost_per_1m ?? null}));

                syncPricingToDb(newPricing);
                console.log(chalk.green(`Successfully updated pricing for ${newPricing.length} models.`));

            } catch (err: any) {
                process.exitCode = 1;
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
                    cached: options.cached ?? null
                });
                console.log(chalk.green(`Successfully added custom pricing for ${options.provider}:${options.model}`));
            } catch (err: any) {
                process.exitCode = 1;
                console.error(chalk.red(`Failed to add custom pricing: ${err.message}`));
            }
        });
}
