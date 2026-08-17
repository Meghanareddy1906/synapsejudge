import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDb, disconnectDb } from './config/db.js';
import { User } from './models/User.js';
import { Problem } from './models/Problem.js';
import { Contest } from './models/Contest.js';
import { logger } from './utils/logger.js';

const PROBLEMS = [
  {
    slug: 'two-sum-indices',
    title: 'Two Sum Indices',
    difficulty: 'easy',
    topics: ['arrays', 'hashing'],
    statement:
      'Given an array of n integers and a target value, find the two distinct positions whose values add up to the target.\n\nIt is guaranteed that exactly one such pair exists. Report the positions in increasing order, using 1-based indexing.',
    inputFormat:
      'The first line contains two integers n and target.\nThe second line contains n integers a1 … an.',
    outputFormat: 'Print two space-separated integers: the 1-based positions of the pair.',
    constraints: '2 ≤ n ≤ 200000\n-10^9 ≤ ai, target ≤ 10^9',
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    testCases: [
      { input: '4 9\n2 7 11 15\n', expectedOutput: '1 2\n', isSample: true },
      { input: '3 6\n3 2 4\n', expectedOutput: '2 3\n', isSample: true },
      { input: '2 -8\n-3 -5\n', expectedOutput: '1 2\n', isSample: false },
      { input: '5 100\n1 2 3 49 51\n', expectedOutput: '4 5\n', isSample: false },
      { input: '6 0\n-1000000000 5 7 1000000000 3 9\n', expectedOutput: '1 4\n', isSample: false },
    ],
  },
  {
    slug: 'longest-balanced-prefix',
    title: 'Longest Balanced Prefix',
    difficulty: 'medium',
    topics: ['strings', 'prefix-sums'],
    statement:
      "You are given a string of '(' and ')' characters.\n\nFind the length of the longest prefix in which the number of opening and closing brackets is equal and no prefix of that prefix ever has more closing brackets than opening ones.",
    inputFormat: 'A single line containing the string s.',
    outputFormat: 'Print one integer: the length of the longest valid balanced prefix.',
    constraints: '1 ≤ |s| ≤ 200000',
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    testCases: [
      { input: '(())()\n', expectedOutput: '6\n', isSample: true },
      { input: '(()))(\n', expectedOutput: '4\n', isSample: true },
      { input: ')(\n', expectedOutput: '0\n', isSample: false },
      { input: '((((\n', expectedOutput: '0\n', isSample: false },
      { input: '()()()()\n', expectedOutput: '8\n', isSample: false },
    ],
  },
  {
    slug: 'minimum-spanning-cost',
    title: 'Minimum Spanning Cost',
    difficulty: 'hard',
    topics: ['graphs', 'greedy', 'disjoint-set-union'],
    statement:
      'You are given a connected weighted undirected graph with n vertices and m edges.\n\nCompute the total weight of its minimum spanning tree.',
    inputFormat:
      'The first line contains two integers n and m.\nEach of the next m lines contains three integers u, v and w describing an edge.',
    outputFormat: 'Print a single integer: the total weight of the minimum spanning tree.',
    constraints: '2 ≤ n ≤ 100000\nn-1 ≤ m ≤ 200000\n1 ≤ w ≤ 10^9',
    timeLimitMs: 3000,
    memoryLimitMb: 512,
    testCases: [
      { input: '4 5\n1 2 1\n2 3 2\n3 4 3\n1 3 4\n2 4 5\n', expectedOutput: '6\n', isSample: true },
      { input: '2 1\n1 2 7\n', expectedOutput: '7\n', isSample: true },
      {
        input: '5 7\n1 2 3\n1 3 1\n2 3 7\n2 4 5\n3 4 2\n4 5 9\n3 5 6\n',
        expectedOutput: '12\n',
        isSample: false,
      },
      { input: '3 3\n1 2 1000000000\n2 3 1000000000\n1 3 1000000000\n', expectedOutput: '2000000000\n', isSample: false },
    ],
  },
  {
    slug: 'reverse-the-digits',
    title: 'Reverse the Digits',
    difficulty: 'easy',
    topics: ['math', 'implementation'],
    statement:
      'Given a non-negative integer n, print the integer formed by reversing its decimal digits.\n\nLeading zeros produced by the reversal are dropped: reversing 1200 gives 21.',
    inputFormat: 'A single line containing the integer n.',
    outputFormat: 'Print the reversed integer.',
    constraints: '0 ≤ n ≤ 10^18',
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    testCases: [
      { input: '1200\n', expectedOutput: '21\n', isSample: true },
      { input: '9\n', expectedOutput: '9\n', isSample: true },
      { input: '0\n', expectedOutput: '0\n', isSample: false },
      { input: '1000000000000000000\n', expectedOutput: '1\n', isSample: false },
      { input: '123456789\n', expectedOutput: '987654321\n', isSample: false },
      { input: '10\n', expectedOutput: '1\n', isSample: false },
    ],
  },
  {
    slug: 'count-distinct-window',
    title: 'Count Distinct in Every Window',
    difficulty: 'medium',
    topics: ['arrays', 'sliding-window', 'hashing'],
    statement:
      'You are given an array of n integers and a window size k.\n\nFor every contiguous window of length k, count how many distinct values it contains. Print all n-k+1 counts.',
    inputFormat:
      'The first line contains two integers n and k.\nThe second line contains n integers a1 … an.',
    outputFormat: 'Print n-k+1 space-separated integers on one line.',
    constraints: '1 ≤ k ≤ n ≤ 200000\n1 ≤ ai ≤ 10^9',
    timeLimitMs: 3000,
    memoryLimitMb: 256,
    testCases: [
      { input: '7 4\n1 2 1 3 4 2 3\n', expectedOutput: '3 4 4 3\n', isSample: true },
      { input: '5 1\n5 5 5 5 5\n', expectedOutput: '1 1 1 1 1\n', isSample: true },
      { input: '3 3\n1 1 2\n', expectedOutput: '2\n', isSample: false },
      { input: '1 1\n1000000000\n', expectedOutput: '1\n', isSample: false },
      { input: '6 2\n1 2 2 3 3 3\n', expectedOutput: '2 1 2 1 1\n', isSample: false },
    ],
  },
  {
    slug: 'shortest-path-grid',
    title: 'Shortest Path in a Grid',
    difficulty: 'medium',
    topics: ['graphs', 'bfs'],
    statement:
      "You are given an n × m grid of characters. '.' is an open cell and '#' is a wall.\n\nStarting from the top-left cell, find the minimum number of moves needed to reach the bottom-right cell, moving only up, down, left or right between open cells. If the destination is unreachable, print -1.",
    inputFormat:
      'The first line contains two integers n and m.\nEach of the next n lines contains m characters.',
    outputFormat: 'Print the minimum number of moves, or -1 if there is no path.',
    constraints: '1 ≤ n, m ≤ 1000\nThe start and destination cells are always open.',
    timeLimitMs: 3000,
    memoryLimitMb: 512,
    testCases: [
      { input: '3 3\n...\n.#.\n...\n', expectedOutput: '4\n', isSample: true },
      { input: '2 2\n.#\n#.\n', expectedOutput: '-1\n', isSample: true },
      { input: '1 1\n.\n', expectedOutput: '0\n', isSample: false },
      { input: '1 5\n.....\n', expectedOutput: '4\n', isSample: false },
      { input: '4 4\n....\n###.\n....\n.###\n', expectedOutput: '-1\n', isSample: false },
      { input: '3 4\n....\n.##.\n....\n', expectedOutput: '5\n', isSample: false },
    ],
  },
  {
    slug: 'maximum-subarray-sum',
    title: 'Maximum Subarray Sum',
    difficulty: 'easy',
    topics: ['arrays', 'dynamic-programming'],
    statement:
      'Given an array of n integers, find the largest sum obtainable from a non-empty contiguous subarray.',
    inputFormat: 'The first line contains the integer n.\nThe second line contains n integers a1 … an.',
    outputFormat: 'Print one integer: the maximum subarray sum.',
    constraints: '1 ≤ n ≤ 200000\n-10^9 ≤ ai ≤ 10^9',
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    testCases: [
      { input: '9\n-2 1 -3 4 -1 2 1 -5 4\n', expectedOutput: '6\n', isSample: true },
      { input: '3\n-5 -2 -9\n', expectedOutput: '-2\n', isSample: true },
      { input: '1\n-1000000000\n', expectedOutput: '-1000000000\n', isSample: false },
      { input: '5\n1 2 3 4 5\n', expectedOutput: '15\n', isSample: false },
      { input: '4\n1000000000 1000000000 -1 1000000000\n', expectedOutput: '2999999999\n', isSample: false },
    ],
  },
];

const HOUR = 3_600_000;

/**
 * Seeded arenas are positioned *relative to seed time* so a freshly deployed
 * instance always has one live contest to demo, one to look forward to, and one
 * with finished standings — rather than three empty rows dated last year.
 */
function contestSpecs(now) {
  return [
    {
      slug: 'weekly-sprint-01',
      title: 'Weekly Sprint #1',
      description:
        'A two-hour warm-up arena. Three problems, increasing difficulty, ICPC-style scoring.',
      rules:
        'Solve as many problems as you can before the timer runs out.\nEach problem awards its full points on your first accepted submission.\nEvery rejected attempt before a solve adds 20 penalty minutes. Penalty only breaks ties.',
      startAt: new Date(now.getTime() - HOUR),
      endAt: new Date(now.getTime() + 23 * HOUR),
      penaltyMinutes: 20,
      problemSlugs: ['two-sum-indices', 'maximum-subarray-sum', 'count-distinct-window'],
      points: [100, 150, 300],
    },
    {
      slug: 'graph-theory-open',
      title: 'Graph Theory Open',
      description: 'Traversal and spanning-tree problems. Opens tomorrow.',
      rules: 'Standard ICPC scoring. Problems are revealed when the arena starts.',
      startAt: new Date(now.getTime() + 24 * HOUR),
      endAt: new Date(now.getTime() + 27 * HOUR),
      penaltyMinutes: 20,
      problemSlugs: ['shortest-path-grid', 'minimum-spanning-cost'],
      points: [200, 400],
    },
    {
      slug: 'beginners-arena',
      title: "Beginner's Arena",
      description: 'An introductory arena that has already finished — standings are final.',
      rules: 'Standard ICPC scoring.',
      startAt: new Date(now.getTime() - 72 * HOUR),
      endAt: new Date(now.getTime() - 70 * HOUR),
      penaltyMinutes: 20,
      problemSlugs: ['reverse-the-digits', 'two-sum-indices'],
      points: [100, 150],
    },
  ];
}

/**
 * Populates problems, arenas and the two starter accounts.
 *
 * Idempotent, and exported so a deploy target with no shell — Render's free
 * tier, for one — can seed itself on boot via SEED_ON_BOOT=true. The caller
 * owns the database connection.
 *
 * The admin password comes from SEED_ADMIN_PASSWORD when set. On a public
 * deployment the documented default is a published credential, so anyone who
 * reads the repo could sign in as admin.
 */
export async function runSeed() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin12345';

  let admin = await User.findOne({ handle: 'admin' });
  if (!admin) {
    admin = new User({ handle: 'admin', email: 'admin@judge.local', role: 'admin' });
    await admin.setPassword(adminPassword);
    await admin.save();
    logger.info(
      process.env.SEED_ADMIN_PASSWORD
        ? 'created admin user — handle "admin", password from SEED_ADMIN_PASSWORD'
        : 'created admin user — handle "admin", password "admin12345" (CHANGE THIS)'
    );
  }

  let demo = await User.findOne({ handle: 'demo' });
  if (!demo) {
    demo = new User({ handle: 'demo', email: 'demo@judge.local' });
    await demo.setPassword('demo12345');
    await demo.save();
    logger.info('created demo user — handle "demo", password "demo12345"');
  }

  const problemsBySlug = new Map();
  for (const spec of PROBLEMS) {
    // Idempotent: re-running the seed refreshes content without duplicating rows.
    const problem = await Problem.findOneAndUpdate(
      { slug: spec.slug },
      { ...spec, isPublished: true, createdBy: admin._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    problemsBySlug.set(spec.slug, problem);
    logger.info(`seeded problem: ${spec.slug}`);
  }

  for (const spec of contestSpecs(new Date())) {
    const { problemSlugs, points, ...fields } = spec;
    const problems = problemSlugs
      .map((slug, index) => {
        const problem = problemsBySlug.get(slug);
        if (!problem) return null;
        return { problem: problem._id, label: 'ABCDEFGH'[index], points: points[index] ?? 100 };
      })
      .filter(Boolean);

    // Registrations are preserved across re-seeds; only the definition is
    // refreshed. Overwriting participants would wipe a running arena.
    const existing = await Contest.findOne({ slug: spec.slug });
    if (existing) {
      Object.assign(existing, fields, { problems });
      await existing.save();
    } else {
      await Contest.create({ ...fields, problems, isPublished: true, createdBy: admin._id });
    }
    logger.info(`seeded arena: ${spec.slug}`);
  }

  logger.info('seed complete.');
}

async function main() {
  await connectDb();
  await runSeed();
  await disconnectDb();
}

// Importing this module (to seed on boot) must not run the script.
const runDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (runDirectly) {
  main().catch(async (err) => {
    logger.error('seed failed:', err);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
}
