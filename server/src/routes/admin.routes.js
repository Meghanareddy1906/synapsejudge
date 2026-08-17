import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Problem, DIFFICULTIES } from '../models/Problem.js';
import { Submission } from '../models/Submission.js';
import { PlagiarismFlag } from '../models/PlagiarismFlag.js';
import { Contest } from '../models/Contest.js';
import { User } from '../models/User.js';
import { ApiError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { slugify } from '../utils/slug.js';
import { enqueueSubmission } from '../queue/queue.js';

const router = Router();

// Every route below is admin-only.
router.use(requireAuth, requireRole('admin'));

const testCaseSchema = z.object({
  input: z.string(),
  expectedOutput: z.string(),
  isSample: z.boolean().default(false),
});

const problemSchema = z.object({
  title: z.string().trim().min(3).max(160),
  slug: z.string().trim().optional(),
  statement: z.string().min(10),
  inputFormat: z.string().default(''),
  outputFormat: z.string().default(''),
  constraints: z.string().default(''),
  difficulty: z.enum(DIFFICULTIES),
  topics: z.array(z.string().trim().min(1)).default([]),
  timeLimitMs: z.number().int().min(200).max(15_000).default(2000),
  memoryLimitMb: z.number().int().min(32).max(1024).default(256),
  testCases: z.array(testCaseSchema).min(1, 'A problem needs at least one test case.'),
  isPublished: z.boolean().default(false),
});

/* ---------------------------------- problems --------------------------------- */

router.get('/problems', async (_req, res, next) => {
  try {
    const problems = await Problem.find().select('-testCases').sort({ createdAt: -1 });
    res.json({
      problems: problems.map((p) => ({
        id: p._id.toString(),
        slug: p.slug,
        title: p.title,
        difficulty: p.difficulty,
        topics: p.topics,
        points: p.points,
        isPublished: p.isPublished,
        stats: p.stats,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/problems/:id', async (req, res, next) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) throw new ApiError(404, 'Problem not found.');
    // Admins get the full document, hidden test cases included.
    res.json({ problem });
  } catch (err) {
    next(err);
  }
});

router.post('/problems', validate(problemSchema), async (req, res, next) => {
  try {
    const body = req.body;
    const problem = await Problem.create({
      ...body,
      slug: slugify(body.slug || body.title),
      createdBy: req.user._id,
    });
    res.status(201).json({ problem });
  } catch (err) {
    next(err);
  }
});

router.put('/problems/:id', validate(problemSchema.partial()), async (req, res, next) => {
  try {
    const problem = await Problem.findById(req.params.id);
    if (!problem) throw new ApiError(404, 'Problem not found.');

    Object.assign(problem, req.body);
    if (req.body.slug || req.body.title) {
      problem.slug = slugify(req.body.slug || req.body.title || problem.title);
    }
    await problem.save();

    res.json({ problem });
  } catch (err) {
    next(err);
  }
});

router.delete('/problems/:id', async (req, res, next) => {
  try {
    const problem = await Problem.findByIdAndDelete(req.params.id);
    if (!problem) throw new ApiError(404, 'Problem not found.');
    await Submission.deleteMany({ problem: problem._id });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/** Re-queue every submission for a problem — used after fixing a bad test case. */
router.post('/problems/:id/rejudge', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Malformed problem id.');
    const submissions = await Submission.find({ problem: req.params.id }).select('_id');

    await Submission.updateMany(
      { problem: req.params.id },
      { $set: { verdict: 'pending', passedTests: 0, testResults: [] } }
    );
    // Enqueue serially so a large rejudge does not spike Redis all at once.
    for (const s of submissions) {
      await enqueueSubmission(s._id);
    }

    res.json({ requeued: submissions.length });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- contests --------------------------------- */

const contestSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    slug: z.string().trim().optional(),
    description: z.string().default(''),
    rules: z.string().default(''),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    penaltyMinutes: z.number().int().min(0).max(120).default(20),
    problems: z
      .array(
        z.object({
          problem: z.string().refine(mongoose.isValidObjectId, 'Malformed problem id.'),
          label: z.string().trim().max(4).optional(),
          points: z.number().int().min(1).max(10_000).default(100),
        })
      )
      .default([]),
    isPublished: z.boolean().default(false),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: 'End time must be after the start time.',
    path: ['endAt'],
  });

router.get('/contests', async (_req, res, next) => {
  try {
    const contests = await Contest.find().sort({ startAt: -1 });
    res.json({
      contests: contests.map((c) => ({
        ...c.toPublic(),
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/contests/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Malformed contest id.');
    const contest = await Contest.findById(req.params.id).populate(
      'problems.problem',
      'slug title difficulty'
    );
    if (!contest) throw new ApiError(404, 'Arena not found.');
    res.json({ contest });
  } catch (err) {
    next(err);
  }
});

/** Rejects problem ids that do not exist, rather than saving a broken arena. */
async function assertProblemsExist(entries) {
  if (!entries?.length) return;
  const ids = entries.map((e) => e.problem);
  const found = await Problem.countDocuments({ _id: { $in: ids } });
  if (found !== new Set(ids.map(String)).size) {
    throw new ApiError(400, 'One or more selected problems no longer exist.');
  }
}

router.post('/contests', validate(contestSchema), async (req, res, next) => {
  try {
    await assertProblemsExist(req.body.problems);
    const contest = await Contest.create({
      ...req.body,
      slug: slugify(req.body.slug || req.body.title),
      createdBy: req.user._id,
    });
    res.status(201).json({ contest: contest.toPublic() });
  } catch (err) {
    next(err);
  }
});

router.put('/contests/:id', validate(contestSchema), async (req, res, next) => {
  try {
    const contest = await Contest.findById(req.params.id);
    if (!contest) throw new ApiError(404, 'Arena not found.');
    await assertProblemsExist(req.body.problems);

    Object.assign(contest, req.body);
    contest.slug = slugify(req.body.slug || req.body.title);
    await contest.save();

    res.json({ contest: contest.toPublic() });
  } catch (err) {
    next(err);
  }
});

router.delete('/contests/:id', async (req, res, next) => {
  try {
    const contest = await Contest.findByIdAndDelete(req.params.id);
    if (!contest) throw new ApiError(404, 'Arena not found.');
    // Submissions survive as practice attempts; only the arena link is dropped.
    await Submission.updateMany({ contest: contest._id }, { $set: { contest: null } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- plagiarism -------------------------------- */

const flagQuerySchema = z.object({
  // Validated rather than passed through: an unchecked `?status[$ne]=x` would
  // reach Mongo as an operator object instead of a string.
  status: z.enum(['pending_review', 'dismissed', 'confirmed', 'all']).default('pending_review'),
});

router.get('/plagiarism', validate(flagQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { status } = req.validatedQuery;
    const flags = await PlagiarismFlag.find(status === 'all' ? {} : { status })
      .populate('problem', 'slug title')
      .populate('userA', 'handle')
      .populate('userB', 'handle')
      .sort({ similarity: -1, createdAt: -1 })
      .limit(200);

    res.json({ flags });
  } catch (err) {
    next(err);
  }
});

/** Side-by-side code for a flagged pair, so a human can make the call. */
router.get('/plagiarism/:id', async (req, res, next) => {
  try {
    const flag = await PlagiarismFlag.findById(req.params.id)
      .populate('problem', 'slug title')
      .populate('userA', 'handle')
      .populate('userB', 'handle');
    if (!flag) throw new ApiError(404, 'Flag not found.');

    const [a, b] = await Promise.all([
      Submission.findById(flag.submissionA).select('code language createdAt'),
      Submission.findById(flag.submissionB).select('code language createdAt'),
    ]);

    res.json({ flag, submissionA: a, submissionB: b });
  } catch (err) {
    next(err);
  }
});

const reviewSchema = z.object({
  status: z.enum(['dismissed', 'confirmed']),
  reviewNote: z.string().max(1000).optional(),
});

router.post('/plagiarism/:id/review', validate(reviewSchema), async (req, res, next) => {
  try {
    const flag = await PlagiarismFlag.findById(req.params.id);
    if (!flag) throw new ApiError(404, 'Flag not found.');

    flag.status = req.body.status;
    flag.reviewNote = req.body.reviewNote;
    flag.reviewedBy = req.user._id;
    flag.reviewedAt = new Date();
    await flag.save();

    res.json({ flag });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------- users ---------------------------------- */

router.get('/users', async (_req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(500);
    res.json({ users: users.map((u) => u.toPublic()) });
  } catch (err) {
    next(err);
  }
});

const roleSchema = z.object({ role: z.enum(['user', 'admin']) });

router.patch('/users/:id/role', validate(roleSchema), async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.user._id)) {
      throw new ApiError(400, 'You cannot change your own role.');
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role: req.body.role },
      { new: true }
    );
    if (!user) throw new ApiError(404, 'User not found.');
    res.json({ user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

export default router;
