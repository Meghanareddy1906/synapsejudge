import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getLanguage } from './languages.js';
import { outputsMatch } from './judge.js';

/**
 * Executes submissions on a hosted Judge0 instance instead of local Docker.
 *
 * This exists for platforms that will not give a process access to the Docker
 * daemon — Render, Railway, Fly and every other managed container host. There
 * the local runner cannot work at all: it shells out to `docker run`, and the
 * daemon is deliberately not reachable from inside a customer container.
 *
 * The security properties are NOT equivalent. With EXECUTION_PROVIDER=docker
 * this project owns the sandbox and can prove what it enforces. Here, isolation
 * is Judge0's to guarantee, and untrusted source is sent to a third-party host.
 * Prefer the Docker provider wherever a real VM is available; see DEPLOY.md.
 */

/** Judge0 status ids → this project's verdicts. */
const STATUS = {
  3: 'ran', // finished cleanly; correctness is decided by comparing output
  4: 'ran', // Judge0's own "wrong answer" — we never send expected_output
  5: 'time_limit_exceeded',
  6: 'compilation_error',
  13: 'internal_error',
  14: 'internal_error',
};

const RUNTIME_ERROR_STATUSES = new Set([7, 8, 9, 10, 11, 12]);

function authHeaders() {
  // A self-hosted or RapidAPI-fronted instance needs a key; the public CE
  // instance does not. Sending an empty header would 401 on the public one.
  if (!env.judge0ApiKey) return {};
  return env.judge0Host
    ? { 'X-RapidAPI-Key': env.judge0ApiKey, 'X-RapidAPI-Host': env.judge0Host }
    : { 'X-Auth-Token': env.judge0ApiKey };
}

async function runOne({ language, code, stdin, timeLimitMs, memoryLimitMb }) {
  const url = `${env.judge0Url.replace(/\/$/, '')}/submissions?base64_encoded=false&wait=true`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      language_id: language.judge0Id,
      source_code: code,
      stdin,
      // Judge0 takes seconds; round up so a 2000 ms limit is not charged as 1 s.
      cpu_time_limit: Math.max(1, Math.ceil(timeLimitMs / 1000)),
      wall_time_limit: Math.max(2, Math.ceil(timeLimitMs / 1000) + 3),
      memory_limit: memoryLimitMb * 1024,
    }),
    signal: AbortSignal.timeout(env.judge0TimeoutMs),
  });

  if (response.status === 429) {
    throw Object.assign(new Error('Execution service is rate limiting.'), { retryable: true });
  }
  if (!response.ok) {
    throw new Error(`Execution service returned ${response.status}.`);
  }

  return response.json();
}

/** One retry on a rate limit, because the public CE instance throttles hard. */
async function runWithRetry(args) {
  try {
    return await runOne(args);
  } catch (err) {
    if (!err.retryable) throw err;
    await new Promise((r) => setTimeout(r, 2500));
    return runOne(args);
  }
}

export async function judgeWithRemote({ submission, problem }) {
  const language = getLanguage(submission.language);
  if (!language?.judge0Id) {
    return {
      verdict: 'internal_error',
      failureDetail: { stderr: `Language ${submission.language} is not mapped for remote execution.` },
    };
  }

  const testCases = problem.testCases ?? [];
  if (testCases.length === 0) {
    return { verdict: 'internal_error', failureDetail: { stderr: 'Problem has no test cases.' } };
  }

  const timeLimitMs = problem.timeLimitMs || env.defaultTimeLimitMs;
  const memoryLimitMb = problem.memoryLimitMb || env.defaultMemoryLimitMb;

  const testResults = [];
  let maxTimeMs = 0;
  let maxMemoryKb = 0;
  let passedTests = 0;

  for (const [index, testCase] of testCases.entries()) {
    let result;
    try {
      result = await runWithRetry({
        language,
        code: submission.code,
        stdin: testCase.input,
        timeLimitMs,
        memoryLimitMb,
      });
    } catch (err) {
      logger.error('remote execution failed:', err.message);
      return {
        verdict: 'internal_error',
        passedTests,
        testResults,
        maxTimeMs,
        failureDetail: { stderr: `Execution service unavailable: ${err.message}` },
      };
    }

    const statusId = result.status?.id;
    const timeMs = Math.round(Number(result.time ?? 0) * 1000);
    maxTimeMs = Math.max(maxTimeMs, timeMs);
    maxMemoryKb = Math.max(maxMemoryKb, Number(result.memory ?? 0));

    const base = { index, timeMs, memoryKb: Number(result.memory ?? 0), isSample: Boolean(testCase.isSample) };

    const failWith = (verdict, extra = {}) => {
      testResults.push({ ...base, verdict });
      return {
        verdict,
        passedTests,
        testResults,
        maxTimeMs,
        maxMemoryKb,
        failureDetail: {
          testIndex: index,
          isSample: Boolean(testCase.isSample),
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: result.stdout ?? '',
          stderr: String(result.stderr ?? '').slice(0, 4000),
          ...extra,
        },
      };
    };

    if (statusId === 6) {
      return {
        verdict: 'compilation_error',
        passedTests,
        testResults,
        maxTimeMs,
        failureDetail: {
          compileOutput: String(result.compile_output ?? 'Compilation failed.').slice(0, 10_000),
        },
      };
    }
    if (STATUS[statusId] === 'time_limit_exceeded') return failWith('time_limit_exceeded');
    if (RUNTIME_ERROR_STATUSES.has(statusId)) {
      // Judge0 has no distinct out-of-memory status; an OOM surfaces as a
      // runtime error, so infer it from the reported usage.
      const verdict =
        Number(result.memory ?? 0) >= memoryLimitMb * 1024 ? 'memory_limit_exceeded' : 'runtime_error';
      return failWith(verdict);
    }
    if (STATUS[statusId] === 'internal_error' || !STATUS[statusId]) {
      return {
        verdict: 'internal_error',
        passedTests,
        testResults,
        maxTimeMs,
        failureDetail: { stderr: result.status?.description ?? 'Unknown execution status.' },
      };
    }

    // Wall-clock overrun that Judge0 counted as success.
    if (timeMs > timeLimitMs) return failWith('time_limit_exceeded');

    if (!outputsMatch(result.stdout ?? '', testCase.expectedOutput)) {
      return failWith('wrong_answer');
    }

    testResults.push({ ...base, verdict: 'accepted' });
    passedTests += 1;
  }

  return { verdict: 'accepted', passedTests, testResults, maxTimeMs, maxMemoryKb, failureDetail: {} };
}
