import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

// Root .env is the single source of truth; a server/.env may override it locally.
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, 'server', '.env'), override: true });

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 4000),
  // Render injects RENDER_EXTERNAL_URL with the service's public URL. Falling
  // back to it means a deploy there needs no manual origin wiring, and cannot
  // drift when the service is renamed.
  clientOrigin:
    process.env.CLIENT_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173',

  // When true the API also serves client/dist. Nginx serving the static build
  // directly is faster and is what the deploy guide sets up; this exists so a
  // single `pm2 start` still produces a working site if Nginx is not in front.
  serveClient: process.env.SERVE_CLIENT === 'true',
  clientDistDir: path.resolve(repoRoot, process.env.CLIENT_DIST_DIR ?? './client/dist'),

  mongoUri: process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/online_judge',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',

  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',

  // Docker needs an absolute host path to bind-mount, and forward slashes on Windows.
  sandboxHostDir: path
    .resolve(repoRoot, process.env.SANDBOX_HOST_DIR ?? './.tmp-submissions')
    .replace(/\\/g, '/'),
  // 'docker' runs submissions in local containers this project controls.
  // 'judge0' delegates to a hosted execution service, for managed platforms
  // that refuse Docker socket access. See server/src/runner/remote.runner.js
  // for why these are not security-equivalent.
  executionProvider: (process.env.EXECUTION_PROVIDER ?? 'docker').toLowerCase(),
  // Host the judge worker inside the API process. For platforms with no
  // separate background-service tier; only sensible with a remote executor.
  runWorkerInApi: process.env.RUN_WORKER_IN_API === 'true',
  judge0Url: process.env.JUDGE0_URL ?? 'https://ce.judge0.com',
  judge0ApiKey: process.env.JUDGE0_API_KEY ?? '',
  judge0Host: process.env.JUDGE0_RAPIDAPI_HOST ?? '',
  judge0TimeoutMs: num(process.env.JUDGE0_TIMEOUT_MS, 30_000),

  judgeConcurrency: num(process.env.JUDGE_CONCURRENCY, 2),
  defaultTimeLimitMs: num(process.env.DEFAULT_TIME_LIMIT_MS, 2000),
  defaultMemoryLimitMb: num(process.env.DEFAULT_MEMORY_LIMIT_MB, 256),
  compileTimeoutMs: num(process.env.COMPILE_TIMEOUT_MS, 10_000),

  embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'local',
  voyageApiKey: process.env.VOYAGE_API_KEY ?? '',
  voyageModel: process.env.VOYAGE_MODEL ?? 'voyage-code-3',
  plagiarismThreshold: num(process.env.PLAGIARISM_THRESHOLD, 0.9),

  repoRoot,
};

export const isProduction = env.nodeEnv === 'production';

if (!env.jwtSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production. Refusing to start.');
  }
  env.jwtSecret = 'dev-only-insecure-secret';
  console.warn('[config] JWT_SECRET is unset — using an insecure development fallback.');
}
