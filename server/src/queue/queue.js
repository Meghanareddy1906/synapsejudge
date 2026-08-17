import { Queue } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';

export const SUBMISSION_QUEUE = 'submissions';

/**
 * Submissions are queued rather than judged inline. The HTTP request returns as
 * soon as the job is enqueued, so a burst of traffic lands in Redis instead of
 * spawning an unbounded number of containers.
 */
export const submissionQueue = new Queue(SUBMISSION_QUEUE, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86_400 },
  },
});

export function enqueueSubmission(submissionId) {
  return submissionQueue.add(
    'judge',
    { submissionId: String(submissionId) },
    // A custom job id makes the enqueue idempotent — a retried request cannot
    // queue the same submission twice. BullMQ reserves ':' as its key
    // separator, so the id must not contain one.
    { jobId: `judge-${submissionId}` }
  );
}

export async function queueDepth() {
  const counts = await submissionQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  return counts;
}
