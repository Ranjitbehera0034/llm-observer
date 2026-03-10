import { Command } from 'commander';
import chalk from 'chalk';
import { exec } from 'child_process';

// LemonSqueezy checkout links — replace with your actual Lemon Squeezy store URLs
// From: https://app.lemonsqueezy.com/products
const CHECKOUT_URLS = {
    pro_monthly: process.env.LEMONSQUEEZY_PRO_MONTHLY_URL || 'https://llmobserver.lemonsqueezy.com/checkout/buy/pro-monthly',
    pro_yearly: process.env.LEMONSQUEEZY_PRO_YEARLY_URL || 'https://llmobserver.lemonsqueezy.com/checkout/buy/pro-yearly',
    team: process.env.LEMONSQUEEZY_TEAM_URL || 'https://llmobserver.lemonsqueezy.com/checkout/buy/team',
    // Razorpay for Indian customers
    razorpay_pro: process.env.RAZORPAY_PRO_URL || 'https://pages.razorpay.com/llm-observer-pro',
};

const openUrl = (url: string) => {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? `open "${url}"` : platform === 'win32' ? `start "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
};

export function setupBillingCommands(program: Command) {
    const billing = program
        .command('upgrade')
        .description('Upgrade to Pro or Team plan')
        .option('--plan <plan>', 'Plan to upgrade to: pro, pro-yearly, team', 'pro')
        .option('--india', 'Use Razorpay checkout (lower price for Indian customers)')
        .action((options) => {
            console.log();
            console.log(chalk.bold.cyan('  LLM Observer — Upgrade'));
            console.log(chalk.gray('  ────────────────────────────────────'));

            if (options.india) {
                // Indian customers — Razorpay
                console.log(`\n  ${chalk.yellow('🇮🇳 Indian pricing via Razorpay:')}`);
                console.log(`  Pro Plan: ₹1,499/month (≈ $18)\n`);
                console.log(chalk.bold(`  Opening Razorpay checkout...\n`));
                openUrl(CHECKOUT_URLS.razorpay_pro);
                console.log(chalk.green(`  ✓ Browser opened: ${CHECKOUT_URLS.razorpay_pro}`));
            } else {
                // International — LemonSqueezy
                const planMap: Record<string, { name: string; price: string; url: string }> = {
                    pro: { name: 'Pro (Monthly)', price: '$19/month', url: CHECKOUT_URLS.pro_monthly },
                    'pro-yearly': { name: 'Pro (Yearly)', price: '$190/year (save $38)', url: CHECKOUT_URLS.pro_yearly },
                    team: { name: 'Team', price: '$49/seat/month', url: CHECKOUT_URLS.team },
                };

                const plan = planMap[options.plan] || planMap['pro'];

                console.log(`\n  Plan: ${chalk.bold(plan.name)}`);
                console.log(`  Price: ${chalk.bold.green(plan.price)}`);
                console.log(`\n  What you get:`);
                console.log(`  ${chalk.green('✓')} Unlimited projects`);
                console.log(`  ${chalk.green('✓')} 90-day log retention`);
                console.log(`  ${chalk.green('✓')} Full budget alerts + OS notifications`);
                console.log(`  ${chalk.green('✓')} Cost optimizer insights`);
                console.log(`  ${chalk.green('✓')} CSV/PDF export reports`);
                console.log(`  ${chalk.green('✓')} Priority email support`);
                console.log();
                console.log(chalk.bold(`  Opening checkout...\n`));
                openUrl(plan.url);
                console.log(chalk.green(`  ✓ Browser opened: ${plan.url}`));
            }

            console.log();
            console.log(chalk.gray('  After payment, you will receive a license key by email.'));
            console.log(chalk.gray(`  Activate it with: ${chalk.white('llm-observer activate <your-key>')}`));
            console.log();
        });

    // Keep the old `billing` command as an alias pointing to `upgrade`
    program
        .command('billing')
        .description('Alias for: llm-observer upgrade')
        .action(() => {
            program.parse(['', '', 'upgrade'], { from: 'user' });
        });
}
