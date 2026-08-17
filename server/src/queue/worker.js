import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { createRedisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { Submission } from '../models/Submission.js';
import { Problem } from '../models/Problem.js';
import { User } from '../models/User.js';
import { judgeSubmission } from '../runner/judge.js';
import { assertDockerAvailable, reapOrphanedContainers } from '../runner/docker.runner.js';
import { analyseForPlagiarism } from '../services/plagiarism.service.js';
import { SUBMISSION_QUEUE } from './queue.js';

/**
 * Recomputes a user's denormalised totals from their accepted submissions.
 *
 * Derived from the source of truth rather than incremented, so a rejudge that
 * turns an AC into a WA corrects the score instead of leaving it inflated.
 */
async function refreshUserScore(userId) {
  const rows = await Submission.aggregate([
    { $match: { user: userId, verdict: 'accepted' } },
    { $group: { _id: '$problem' } },
    {
      $lookup: {
        from: Problem.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'problem',
      },
    },
    { $unwind: '$problem' },
    { $group: { _id: null, solvedCount: { $sum: 1 }, points: { $sum: '$problem.points' } } },
  ]);

  const { solvedCount = 0, points = 0 } = rows[0] ?? {};
  await User.updateOne({ _id: userId }, { $set: { solvedCount, points } });
}

async function processJob(job) {
  const { submissionId } = job.data;

  const submission = await Submission.findById(submissionId);
  if (!submission) {
    logger.warn(`submission ${submissionId} vanished before judging; dropping job.`);
    return;
  }

  const problem = await Problem.findById(submission.problem);
  if (!problem) {
    submission.verdict = 'internal_error';
    submission.failureDetail = { stderr: 'Problem no longer exists.' };
    submission.judgedAt = new Date();
    await submission.save();
    return;
  }

  submission.verdict = 'running';
  await submission.save();

  const result = await judgeSubmission({ submission, problem });

  submission.verdict = result.verdict;
  submission.passedTests = result.passedTests ?? 0;
  submission.totalTests = problem.testCases.length;
  submission.maxTimeMs = result.maxTimeMs ?? 0;
  submission.testResults = result.testResults ?? [];
  submission.failureDetail = result.failureDetail ?? {};
  submission.judgedAt = new Date();
  await submission.save();

  logger.info(
    `judged ${submissionId}: ${result.verdict} (${submission.passedTests}/${submission.totalTests})`
  );

  if (result.verdict === 'accepted') {
    await Problem.updateOne({ _id: problem._id }, { $inc: { 'stats.accepted': 1 } });
    // Similarity analysis only makes sense between working solutions.
    await analyseForPlagiarism(submission);
  }

  // Always recompute: a rejudge that turns an AC into a WA must lower the score,
  // not just skip the increment.
  await refreshUserScore(submission.user);
}

/**
 * Creates the judge worker and starts consuming jobs.
 *
 * Exported so the API can host it in-process (RUN_WORKER_IN_API=true) on
 * platforms that do not offer a separate background service. That is only
 * sane under EXECUTION_PROVIDER=judge0, where judging is an outbound HTTP call
 * rather than CPU work — running local containers inside the web process would
 * put the judge and the request path in contention for the same cores.
 *
 * The caller owns the database connection and the shutdown signals.
 */
export async function startWorker() {
  // Docker is only a prerequisite when this worker is the one running the
  // containers. Under EXECUTION_PROVIDER=judge0 there is no local daemon by
  // design, and demanding one would stop the worker from ever starting.
  if (env.executionProvider === 'judge0') {
    logger.warn(
      `execution provider: judge0 (${env.judge0Url}) — submissions run off-host, not in local containers.`
    );
  } else {
    await assertDockerAvailable();
    // A previous worker may have died holding containers open; clear them before
    // taking new jobs so a restart does not compound the leak.
    await reapOrphanedContainers();
  }

  const worker = new Worker(SUBMISSION_QUEUE, processJob, {
    connection: createRedisConnection(),
    concurrency: env.judgeConcurrency,
    // A judge job holds a container open; give it room before the lock expires.
    lockDuration: 120_000,
  });

  worker.on('failed', async (job, err) => {
    logger.error(`job ${job?.id} failed:`, err?.message);

    // Last attempt exhausted — tell the student rather than leaving them at
    // "running" forever.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await Submission.updateOne(
        { _id: job.data.submissionId },
        {
          $set: {
            verdict: 'internal_error',
            judgedAt: new Date(),
            'failureDetail.stderr': 'The judge failed to evaluate this submission.',
          },
        }
      ).catch((updateErr) => logger.error('could not mark submission failed:', updateErr));
    }
  });

  worker.on('error', (err) => logger.error('worker error:', err));

  logger.info(`judge worker ready (concurrency ${env.judgeConcurrency})`);

  return worker;
}

async function main() {
  await connectDb();
  const worker = await startWorker();

  const shutdown = async (signal) => {
    logger.info(`${signal} received — draining judge worker.`);
    await worker.close();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only self-start when run directly. Importing this module — as the API does to
// host the worker in-process — must not spin up a second one.
const runDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (runDirectly) {
  main().catch((err) => {
    logger.error('judge worker failed to start:', err.message);
    process.exit(1);
  });
}
