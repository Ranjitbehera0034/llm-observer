import { RequestRecord, bulkInsertRequests, getAlertRules, createAlert } from '@llm-observer/database';

const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 5000; // 5 seconds

let queue: Omit<RequestRecord, 'id'>[] = [];
let timeout: NodeJS.Timeout | null = null;

/**
 * Internal logger that batches requests and inserts them into SQLite.
 * This replaces the Redis/BullMQ dependency for a zero-config local experience.
 */
export const internalLogger = {
    add: async (requestData: Omit<RequestRecord, 'id'>) => {
        queue.push(requestData);

        // Instant alert evaluation (non-blocking)
        evaluateAlertRules(requestData).catch(err => console.error('Alert evaluation failed:', err));

        if (queue.length >= BATCH_SIZE) {
            internalLogger.flush().catch(err => console.error('Immediate flush failed:', err));
        } else if (!timeout) {
            timeout = setTimeout(() => {
                internalLogger.flush().catch(err => console.error('Delayed flush failed:', err));
            }, BATCH_TIMEOUT);
        }
    },

    flush: async () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }

        if (queue.length === 0) return;

        const batch = [...queue];
        queue = [];

        try {
            bulkInsertRequests(batch);
        } catch (err) {
            console.error('Failed to flush request logs to SQLite:', err);
        }
    }
};

async function evaluateAlertRules(requestData: any) {
    try {
        const rules = getAlertRules(requestData.project_id || 'default');

        for (const rule of rules) {
            if (!rule.is_active) continue;

            let isTriggered = false;
            let message = '';

            switch (rule.condition_type) {
                case 'error_rate':
                    if (requestData.status_code >= 400 && rule.threshold > 0) {
                        isTriggered = true;
                        message = `Error detected: Request failed with status ${requestData.status_code} on ${requestData.provider}`;
                    }
                    break;
                case 'latency_spike':
                    if (requestData.latency_ms > rule.threshold) {
                        isTriggered = true;
                        message = `Latency spike detected: ${requestData.latency_ms}ms exceeded threshold of ${rule.threshold}ms`;
                    }
                    break;
                case 'budget_threshold':
                    if (requestData.cost_usd > rule.threshold) {
                        isTriggered = true;
                        message = `Large query cost detected: $${requestData.cost_usd.toFixed(4)} exceeded single-query threshold $${rule.threshold}`;
                    }
                    break;
            }

            if (isTriggered) {
                createAlert({
                    project_id: requestData.project_id || 'default',
                    type: rule.condition_type,
                    severity: 'critical',
                    message,
                    data: JSON.stringify(requestData),
                    notified_via: rule.webhook_url ? 'webhook' : 'dashboard'
                });

                if (rule.webhook_url) {
                    dispatchWebhook(rule.webhook_url, {
                        rule_name: rule.name,
                        message,
                        timestamp: new Date().toISOString(),
                        project_id: requestData.project_id
                    }).catch(err => console.error(`Failed to dispatch webhook for rule ${rule.name}`, err));
                }
            }
        }
    } catch (err) {
        console.error('Error evaluating alert rules:', err);
    }
}

async function dispatchWebhook(url: string, payload: any) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            console.error(`Webhook payload rejected by ${url} with status ${res.status}`);
        }
    } catch (err) {
        console.error(`Webhook dispatch failed: ${err}`);
    }
}
