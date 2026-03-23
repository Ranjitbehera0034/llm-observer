import { getDb, decrypt } from '@llm-observer/database';
import { AnthropicPoller } from './anthropic-poller';

export class UsageSyncManager {
    private pollers: Map<string, any> = new Map();
    private isRunning: boolean = false;

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[UsageSyncManager] Starting usage sync background workers...');

        const db = getDb();
        const configs = db.prepare("SELECT * FROM usage_sync_configs WHERE status = 'active'").all() as any[];

        for (const config of configs) {
            this.startPoller(config);
        }
    }

    startPoller(config: any) {
        if (this.pollers.has(config.id)) {
            this.pollers.get(config.id).stop();
        }

        let poller;
        if (config.id === 'anthropic') {
            poller = new AnthropicPoller(config);
            poller.start();
            this.pollers.set(config.id, poller);
            console.log(`[UsageSyncManager] Initialized poller for ${config.display_name}`);
        }
    }

    stop() {
        this.isRunning = false;
        for (const poller of this.pollers.values()) {
            poller.stop();
        }
        this.pollers.clear();
        console.log('[UsageSyncManager] All pollers stopped.');
    }

    async refreshConfig(providerId: string) {
        const db = getDb();
        const config = db.prepare('SELECT * FROM usage_sync_configs WHERE id = ?').get(providerId) as any;
        if (config && config.status === 'active') {
            this.startPoller(config);
        } else {
            if (this.pollers.has(providerId)) {
                this.pollers.get(providerId).stop();
                this.pollers.delete(providerId);
            }
        }
    }
}

export const usageSyncManager = new UsageSyncManager();
