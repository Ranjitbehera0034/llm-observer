import { getAlertRules, createAlert } from '@llm-observer/database';

export const evaluateAlertRules = async (requestData: any) => {
    try {
        const rules = getAlertRules(requestData.project_id || 'default');

        for (const rule of rules) {
            if (!rule.is_active) continue;

            let isTriggered = false;
            let message = '';

            // Simplified Evaluation Logic for MVP
            switch (rule.condition_type) {
                case 'error_rate':
                    if (requestData.status_code >= 400 && rule.threshold > 0) {
                        isTriggered = true; // In full version, this would check average over time_window
                        message = `Error rate anomaly detected: Request failed with status ${requestData.status_code} on ${requestData.provider}`;
                    }
                    break;
                case 'latency_spike':
                    if (requestData.latency_ms > rule.threshold) {
                        isTriggered = true;
                        message = `Latency spike detected: ${requestData.latency_ms}ms exceeded threshold of ${rule.threshold}ms`;
                    }
                    break;
                case 'budget_threshold':
                    // We assume cost logic in proxy handled this, but we can emit generic cost alerts based on single large queries for MVP
                    if (requestData.cost_usd > rule.threshold) {
                        isTriggered = true;
                        message = `Large query cost detected: $${requestData.cost_usd.toFixed(4)} exceeded single-query threshold $${rule.threshold}`;
                    }
                    break;
            }

            if (isTriggered) {
                // 1. Record Alert in Database
                const alertRecord = {
                    project_id: requestData.project_id,
                    type: rule.condition_type,
                    severity: 'high',
                    message,
                    data: JSON.stringify(requestData),
                    notified_via: rule.webhook_url ? 'webhook' : 'dashboard'
                };

                createAlert(alertRecord);

                // 2. Dispatch Webhook
                if (rule.webhook_url) {
                    dispatchWebhook(rule.webhook_url, {
                        rule_name: rule.name,
                        message,
                        timestamp: new Date().toISOString(),
                        request_id: requestData.id,
                        project_id: requestData.project_id
                    }).catch(err => console.error(`Failed to dispatch webhook for rule ${rule.name}`, err));
                }
            }
        }
    } catch (err) {
        console.error('Error evaluating alert rules:', err);
    }
};

const dispatchWebhook = async (url: string, payload: any) => {
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
        throw new Error(`Execution failed targeting ${url}: ${err}`);
    }
};
