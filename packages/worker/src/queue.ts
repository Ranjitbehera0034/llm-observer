import { Worker, Job } from 'bullmq';
import { insertRequest, initDb } from '@llm-observer/database';
import { evaluateAlertRules } from './evaluator';
import Redis from 'ioredis';

const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null // Required by bullmq
});

export const startWorker = () => {
    initDb(); // Ensure DB is ready for writing

    const worker = new Worker(
        'request-logs',
        async (job: Job) => {
            const { requestData } = job.data;
            try {
                insertRequest(requestData);
                console.log(`✅ [Worker] Processed and persisted job: ${job.id}`);

                // Async background rule evaluation
                evaluateAlertRules(requestData).catch(err => console.error(err));

            } catch (error) {
                console.error(`❌ [Worker] Failed to process job: ${job.id}`, error);
                throw error;
            }
        },
        { connection: redisConnection as any }
    );

    worker.on('ready', () => {
        console.log('👷 LLM Observer Worker listening on queue "request-logs"');
    });

    worker.on('error', err => {
        console.error('Worker error:', err);
    });

    return worker;
};
