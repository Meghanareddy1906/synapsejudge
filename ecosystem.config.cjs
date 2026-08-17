/**
 * PM2 process definitions for a single-host deployment.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup     # survive a reboot
 *
 * Two processes, deliberately:
 *
 *  - `synapsejudge-api` is stateless HTTP. It never touches Docker, so it can be
 *    scaled with `instances` or moved to another host without changing anything.
 *  - `synapsejudge-worker` spawns judge containers and therefore needs the Docker
 *    socket. That socket is root-equivalent on the host, so the worker is the
 *    real trust boundary of this deployment — keep its instance count matched to
 *    the box's cores rather than to request volume.
 *
 * Both read the same root .env via server/src/config/env.js.
 */
module.exports = {
  apps: [
    {
      name: 'synapsejudge-api',
      script: 'server/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      error_file: 'logs/api.error.log',
      out_file: 'logs/api.out.log',
      time: true,
    },
    {
      name: 'synapsejudge-worker',
      script: 'server/src/queue/worker.js',
      // Never cluster this: JUDGE_CONCURRENCY already controls how many
      // containers are in flight, and a second worker process would multiply it.
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
      // A judge run holds a container open; give it time to drain on reload.
      kill_timeout: 15_000,
      error_file: 'logs/worker.error.log',
      out_file: 'logs/worker.out.log',
      time: true,
    },
  ],
};
