import { NewRequestRecord, bulkInsertRequests, getAlertRules, createAlert } from '@llm-observer/database';

const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 5000; // 5 seconds
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 10_000;

// "<project>:<rule>" -> time the rule last fired, so one bad minute doesn't
// write an alert row (and fire a webhook) for every request in it.
const lastAlertAt = new Map<string, number>();

/** Test hook: forget which rules have fired recently. */
export function __resetAlertCooldownsForTests(): void {
    lastAlertAt.clear();
}

let queue: NewRequestRecord[] = [];
let timeout: NodeJS.Timeout | null = null;

/**
 * Internal logger that batches requests and inserts them into SQLite.
 * This replaces the Redis/BullMQ dependency for a zero-config local experience.
 */
export const internalLogger = {
    /**
     * Read accessor for the spend ledger: rows added but not yet written to SQLite. The array is the
     * live queue, not a copy; callers must only read it, synchronously. flush() empties the queue and
     * inserts its rows in one synchronous step, so a row is always in exactly one of "queued" or
     * "recorded" from the point of view of code that does not await between its two reads.
     */
    getQueued: (): readonly NewRequestRecord[] => queue,

    add: async (requestData: NewRequestRecord) => {
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
                const projectId = requestData.project_id || 'default';
                const cooldownKey = `${projectId}:${rule.id}`;
                const now = Date.now();
                const last = lastAlertAt.get(cooldownKey);
                if (last !== undefined && now - last < ALERT_COOLDOWN_MS) continue;
                lastAlertAt.set(cooldownKey, now);

                createAlert({
                    project_id: projectId,
                    type: rule.condition_type,
                    severity: 'critical',
                    message,
                    // Metadata only: prompts and responses must not outlive request retention.
                    data: JSON.stringify({
                        request_id: requestData.id ?? null,
                        project_id: projectId,
                        model: requestData.model,
                        status: requestData.status,
                        cost_usd: requestData.cost_usd,
                        latency_ms: requestData.latency_ms
                    }),
                    notified_via: rule.webhook_url ? 'webhook' : 'dashboard'
                });

                if (rule.webhook_url) {
                    dispatchWebhook(rule.webhook_url, {
                        rule_name: rule.name,
                        message,
                        timestamp: new Date().toISOString(),
                        project_id: projectId
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
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
        });
        if (!res.ok) {
            console.error(`Webhook payload rejected by ${url} with status ${res.status}`);
        }
    } catch (err) {
        console.error(`Webhook dispatch failed: ${err}`);
    }
}
