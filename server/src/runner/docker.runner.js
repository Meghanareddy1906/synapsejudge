import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

// Guard the judge itself: a program printing in an infinite loop must not be
// able to exhaust the worker's heap before the wall clock kills it.
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Exit code for a process terminated by SIGKILL (128 + 9). */
const SIGKILL_EXIT = 137;

/**
 * Every judge container is named so it can be reaped by name.
 *
 * This prefix is also what the worker sweeps on boot, so a worker that was
 * killed mid-judge does not leave containers running forever.
 */
export const CONTAINER_PREFIX = 'sj-judge-';

/** How long to wait for the daemon to stop a container before killing the CLI. */
const REAP_GRACE_MS = 3000;

/**
 * Flags applied to every container, compile and run alike.
 *
 * --network none            no egress, no lateral movement, no exfiltration
 * --cap-drop ALL            drop every Linux capability
 * --security-opt ...        a setuid binary cannot regain privileges
 * --user 65534:65534        run as `nobody`, never root
 * --read-only               the container filesystem itself is immutable
 * --pids-limit              caps fork bombs
 * --memory == --memory-swap disables swap, so the memory cap is a real cap
 */
function baseFlags({ memoryLimitMb, cpus = 1, pidsLimit = 96 }) {
  return [
    '--rm',
    '--interactive',
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    '--read-only',
    '--pids-limit', String(pidsLimit),
    '--memory', `${memoryLimitMb}m`,
    '--memory-swap', `${memoryLimitMb}m`,
    '--cpus', String(cpus),
    '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=64m',
    '--workdir', '/sandbox',
  ];
}

function envFlags(vars = {}) {
  return Object.entries(vars).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
}

/**
 * Runs one command in a throwaway container and resolves with its result.
 * Never rejects on program failure — a non-zero exit is data, not an exception.
 */
export function runInContainer({
  image,
  argv,
  stdin = '',
  timeoutMs,
  memoryLimitMb,
  srcDir,
  buildDir,
  buildWritable = false,
  env: containerEnv = {},
  cpus = 1,
}) {
  const containerName = `${CONTAINER_PREFIX}${randomUUID()}`;

  const args = [
    'run',
    // Named so the container can be stopped on the daemon by name. Killing the
    // `docker run` client does NOT stop the container it started.
    '--name', containerName,
    ...baseFlags({ memoryLimitMb, cpus }),
    ...envFlags(containerEnv),
    '--volume', `${srcDir}:/sandbox:ro`,
  ];

  if (buildDir) {
    args.push('--volume', `${buildDir}:/build:${buildWritable ? 'rw' : 'ro'}`);
  }

  args.push(image, ...argv);

  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    let graceTimer = null;

    /**
     * Stops the container on the daemon.
     *
     * This is the part that actually matters. `child.kill()` only kills the
     * local `docker run` process — the container keeps running, and because it
     * is an infinite loop by definition, it keeps burning a full core forever.
     * A handful of time-limit-exceeded submissions would take the host down.
     *
     * `rm --force` both stops and removes; racing `--rm` is harmless, and a
     * container that already exited just yields "No such container", ignored.
     */
    const reapContainer = () => {
      const reaper = spawn('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
      reaper.on('error', (err) => logger.warn(`could not reap ${containerName}:`, err.message));
    };

    /** Stop the container, then fall back to killing the CLI if it lingers. */
    const terminate = () => {
      reapContainer();
      // Once the container dies the client exits on its own and `close` fires.
      // If the daemon is wedged, don't hang the judge on it.
      graceTimer = setTimeout(() => child.kill('SIGKILL'), REAP_GRACE_MS);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        if (!outputTruncated) {
          outputTruncated = true;
          terminate();
        }
        return;
      }
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });

    const finish = (exitCode, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);

      // If the CLI had to be killed outright the container may have outlived it.
      if (timedOut || outputTruncated) reapContainer();

      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        outputTruncated,
        oomKilled: !timedOut && exitCode === SIGKILL_EXIT,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        spawnError,
      });
    };

    child.on('error', (err) => {
      // `docker` missing from PATH lands here.
      logger.error('failed to spawn docker:', err.message);
      finish(-1, err.message);
    });

    child.on('close', (code) => finish(code ?? -1));

    // A program that never reads stdin makes this pipe fail; that is expected.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

/** Verifies Docker is reachable before the worker starts accepting jobs. */
export async function assertDockerAvailable() {
  const ok = await new Promise((resolve) => {
    const child = spawn('docker', ['version', '--format', '{{.Server.Version}}']);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });

  if (!ok) {
    throw new Error(
      'Docker is not reachable. The judge cannot run submissions without it — start Docker Desktop / dockerd and retry.'
    );
  }
}

/**
 * Removes judge containers left over from a previous worker.
 *
 * A worker killed mid-judge (deploy, OOM, `pm2 restart`) never runs its own
 * reaper, so its containers survive it — and a stranded infinite loop holds a
 * core indefinitely. Sweeping on boot bounds that to one worker lifetime.
 *
 * Only containers carrying the judge's own name prefix are touched.
 */
export async function reapOrphanedContainers() {
  const names = await new Promise((resolve) => {
    const child = spawn('docker', [
      'ps', '--all', '--quiet',
      '--filter', `name=^${CONTAINER_PREFIX}`,
    ]);
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('error', () => resolve([]));
    child.on('close', () => resolve(out.split('\n').map((s) => s.trim()).filter(Boolean)));
  });

  if (names.length === 0) return 0;

  await new Promise((resolve) => {
    const child = spawn('docker', ['rm', '--force', ...names], { stdio: 'ignore' });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });

  logger.warn(`reaped ${names.length} orphaned judge container(s) from a previous run.`);
  return names.length;
}
