import IORedis from 'ioredis';
import { env } from './env.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connection — the blocking
 * commands it uses would otherwise be aborted by ioredis' retry ceiling.
 */
export function createRedisConnection() {
  return new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// Shared connection for plain cache reads (not for BullMQ blocking commands).
export const cache = new IORedis(env.redisUrl, { lazyConnect: true });
