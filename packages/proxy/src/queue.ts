import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null
});

export const requestLogsQueue = new Queue('request-logs', { connection: redisConnection as any });
