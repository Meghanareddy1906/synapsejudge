import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getLanguage } from './languages.js';
import { runInContainer } from './docker.runner.js';

/**
 * Trailing whitespace is not a wrong answer. Normalise line endings, strip
 * trailing spaces on each line, and drop trailing blank lines before comparing.
 */
export function normaliseOutput(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

export function outputsMatch(actual, expected) {
  return normaliseOutput(actual) === normaliseOutput(expected);
}

async function stageSubmission(submissionId, language, code) {
  const root = path.join(env.sandboxHostDir, String(submissionId));
  const srcDir = path.join(root, 'src');
  const buildDir = path.join(root, 'build');

  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(buildDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, language.sourceFile), code, 'utf8');

  // The container runs as uid 65534; on Linux hosts the bind mount inherits
  // host ownership, so the compiler needs the build dir to be world-writable.
  await fs.chmod(buildDir, 0o777).catch(() => {});

  return {
    root,
    // Docker on Windows wants forward slashes in bind-mount sources.
    srcDir: srcDir.replace(/\\/g, '/'),
    buildDir: buildDir.replace(/\\/g, '/'),
  };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true }).catch((err) => {
    logger.warn(`failed to clean sandbox dir ${root}:`, err.message);
  });
}

/**
 * Judges one submission end to end.
 *
 * Execution stops at the first failing test — an online judge reports the first
 * failure, and continuing would burn container startups for no extra signal.
 *
 * Returns a plain result object; persistence is the caller's job.
 */
export async function judgeSubmission({ submission, problem }) {
  // Delegated at the top rather than per-step: a hosted service compiles and
  // runs in one call, so the staging/compile/run choreography below has no
  // meaning for it.
  if (env.executionProvider === 'judge0') {
    const { judgeWithRemote } = await import('./remote.runner.js');
    return judgeWithRemote({ submission, problem });
  }

  const language = getLanguage(submission.language);
  if (!language) {
    return {
      verdict: 'internal_error',
      failureDetail: { stderr: `Unsupported language: ${submission.language}` },
    };
  }

  const testCases = problem.testCases ?? [];
  if (testCases.length === 0) {
    return { verdict: 'internal_error', failureDetail: { stderr: 'Problem has no test cases.' } };
  }

  const timeLimitMs = problem.timeLimitMs || env.defaultTimeLimitMs;
  const memoryLimitMb = problem.memoryLimitMb || env.defaultMemoryLimitMb;

  const staged = await stageSubmission(submission._id, language, submission.code);

  try {
    /* ------------------------------- compile ------------------------------- */
    if (language.compile) {
      const compiled = await runInContainer({
        image: language.image,
        argv: language.compile,
        timeoutMs: env.compileTimeoutMs,
        // Compilers need more headroom than the program itself.
        memoryLimitMb: Math.max(memoryLimitMb, 512),
        srcDir: staged.srcDir,
        buildDir: staged.buildDir,
        buildWritable: true,
        env: language.env,
        cpus: 2,
      });

      if (compiled.spawnError) {
        return {
          verdict: 'internal_error',
          failureDetail: { stderr: `Judge could not start a container: ${compiled.spawnError}` },
        };
      }

      if (compiled.timedOut) {
        return {
          verdict: 'compilation_error',
          failureDetail: { compileOutput: 'Compilation timed out.' },
        };
      }

      if (compiled.exitCode !== 0) {
        return {
          verdict: 'compilation_error',
          failureDetail: {
            compileOutput: (compiled.stderr || compiled.stdout || 'Compilation failed.').slice(
              0,
              10_000
            ),
          },
        };
      }
    }

    /* -------------------------------- run ---------------------------------- */
    const testResults = [];
    let maxTimeMs = 0;
    let passedTests = 0;

    for (const [index, testCase] of testCases.entries()) {
      const result = await runInContainer({
        image: language.image,
        argv: language.run,
        stdin: testCase.input,
        // A little slack over the limit so container startup is not charged
        // against the author's time budget; the reported time is the real one.
        timeoutMs: timeLimitMs + 1500,
        memoryLimitMb,
        srcDir: staged.srcDir,
        // Read-only for execution — the compiler's writable window is closed.
        buildDir: staged.buildDir,
        buildWritable: false,
        env: language.env,
      });

      maxTimeMs = Math.max(maxTimeMs, Math.round(result.durationMs));

      if (result.spawnError) {
        return {
          verdict: 'internal_error',
          passedTests,
          testResults,
          maxTimeMs,
          failureDetail: { stderr: `Judge could not start a container: ${result.spawnError}` },
        };
      }

      const base = {
        index,
        timeMs: Math.round(result.durationMs),
        memoryKb: 0,
        isSample: Boolean(testCase.isSample),
      };

      const failWith = (verdict, extra = {}) => {
        testResults.push({ ...base, verdict });
        return {
          verdict,
          passedTests,
          testResults,
          maxTimeMs,
          failureDetail: {
            testIndex: index,
            isSample: Boolean(testCase.isSample),
            input: testCase.input,
            expectedOutput: testCase.expectedOutput,
            actualOutput: result.stdout,
            stderr: result.stderr.slice(0, 4000),
            ...extra,
          },
        };
      };

      if (result.timedOut || result.durationMs > timeLimitMs) {
        return failWith('time_limit_exceeded');
      }
      if (result.oomKilled) {
        return failWith('memory_limit_exceeded');
      }
      if (result.outputTruncated) {
        return failWith('wrong_answer', {
          stderr: 'Output exceeded 1 MB and was truncated.',
        });
      }
      if (result.exitCode !== 0) {
        return failWith('runtime_error');
      }
      if (!outputsMatch(result.stdout, testCase.expectedOutput)) {
        return failWith('wrong_answer');
      }

      testResults.push({ ...base, verdict: 'accepted' });
      passedTests += 1;
    }

    return { verdict: 'accepted', passedTests, testResults, maxTimeMs, failureDetail: {} };
  } finally {
    await cleanup(staged.root);
  }
}
