import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { submissionQueue } from './queue/queue.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDb();

  // Deploy targets without shell access cannot run `npm run seed`, so allow the
  // process to seed itself. Idempotent, and a failure here must not stop the
  // API from serving — an empty catalogue is better than no site.
  if (process.env.SEED_ON_BOOT === 'true') {
    try {
      const { runSeed } = await import('./seed.js');
      await runSeed();
    } catch (err) {
      logger.error('seed on boot failed (continuing):', err.message);
    }
  }

  let worker = null;
  if (env.runWorkerInApi) {
    const { startWorker } = await import('./queue/worker.js');
    worker = await startWorker();
    logger.info('judge worker is running inside the API process.');
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down.`);
    server.close(async () => {
      // Drain in-flight judging before the database goes away, or a submission
      // caught mid-verdict is left stuck at "running" forever.
      if (worker) await worker.close().catch(() => {});
      // Close the queue's Redis connection too — exiting with it still open
      // tears the handle down mid-flight and aborts the process noisily.
      await submissionQueue.close().catch(() => {});
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('failed to start API:', err);
  process.exit(1);
});
