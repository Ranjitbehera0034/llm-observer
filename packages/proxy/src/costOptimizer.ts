import { getDb, createAlert } from '@llm-observer/database';
import chalk from 'chalk';
import { getCostOptimizationSuggestions, getPromptCacheSuggestions } from '@llm-observer/database';

export function startCostOptimizer(intervalMs: number = 6 * 60 * 60 * 1000) {
    console.log(chalk.gray('Starting background cost optimizer engine...'));
    runOptimizationCheck();
    setInterval(runOptimizationCheck, intervalMs);
}

async function runOptimizationCheck() {
    try {
        const db = getDb();
        const projects = db.prepare('SELECT id, name FROM projects').all() as any[];

        for (const project of projects) {
            const costSuggestions = getCostOptimizationSuggestions(project.id);
            const cacheSuggestions = getPromptCacheSuggestions(project.id);

            const allSuggestions = [...costSuggestions, ...cacheSuggestions];

            for (const suggestion of allSuggestions) {
                // Check if this specific insight was recently created to avoid spamming
                const existing = db.prepare(`
                    SELECT id FROM alerts 
                    WHERE project_id = ? AND type = 'OPTIMIZER_INSIGHT' 
                    AND message = ? AND acknowledged = 0
                `).get(project.id, suggestion.description);

                if (!existing) {
                    createAlert({
                        project_id: project.id,
                        type: 'OPTIMIZER_INSIGHT',
                        severity: 'info',
                        message: suggestion.description,
                        data: JSON.stringify(suggestion)
                    });
                    console.log(chalk.blue(`[Optimizer] New insight for ${project.name}: ${suggestion.title}`));
                }
            }
        }
    } catch (error) {
        console.error(chalk.red('[Optimizer] Error running optimization check:'), error);
    }
}
