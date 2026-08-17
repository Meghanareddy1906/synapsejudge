import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Submission } from '../models/Submission.js';
import { Problem } from '../models/Problem.js';
import { Contest } from '../models/Contest.js';
import { ApiError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { LANGUAGE_IDS, LANGUAGES } from '../runner/languages.js';
import { enqueueSubmission, queueDepth } from '../queue/queue.js';

const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?._id?.toString() ?? req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Slow down — max 10 submissions per minute.' },
});

const submitSchema = z.object({
  problemId: z.string().refine(mongoose.isValidObjectId, 'Malformed problem id.'),
  language: z.enum(LANGUAGE_IDS),
  code: z.string().min(1, 'Code cannot be empty.').max(100_000, 'Submission exceeds 100 KB.'),
  // Present only when submitting from inside an arena.
  contestId: z.string().refine(mongoose.isValidObjectId, 'Malformed contest id.').optional(),
});

/**
 * Resolves the contest a submission should be attributed to.
 *
 * Returns null for practice submissions. Throws rather than silently dropping
 * the attribution: a competitor who submits from an arena page and lands in
 * practice by mistake would lose the solve without ever being told.
 */
async function resolveContest(contestId, problemId, user) {
  if (!contestId) return null;

  const contest = await Contest.findById(contestId);
  if (!contest || !contest.isPublished) throw new ApiError(404, 'Arena not found.');

  const status = contest.statusAt();
  if (status === 'upcoming') throw new ApiError(409, 'This arena has not started yet.');
  if (status === 'ended') throw new ApiError(409, 'This arena has finished. Submit from the problem page to practise.');

  const inContest = contest.problems.some((entry) => String(entry.problem) === String(problemId));
  if (!inContest) throw new ApiError(400, 'That problem is not part of this arena.');

  // Join-on-submit: someone who solved a problem should never lose it to a
  // missing registration click. The explicit Register button still exists.
  if (!contest.participants.some((p) => String(p.user) === String(user._id))) {
    await Contest.updateOne(
      { _id: contest._id, 'participants.user': { $ne: user._id } },
      { $push: { participants: { user: user._id, registeredAt: new Date() } } }
    );
  }

  return contest;
}

router.get('/languages', (_req, res) => {
  res.json({
    languages: Object.values(LANGUAGES).map((l) => ({ id: l.id, label: l.label })),
  });
});

router.post('/', requireAuth, submitLimiter, validate(submitSchema), async (req, res, next) => {
  try {
    const { problemId, language, code, contestId } = req.body;

    const problem = await Problem.findById(problemId).select('isPublished testCases');
    if (!problem || !problem.isPublished) throw new ApiError(404, 'Problem not found.');
    if (problem.testCases.length === 0) {
      throw new ApiError(409, 'This problem has no test cases yet.');
    }

    const contest = await resolveContest(contestId, problem._id, req.user);

    const submission = await Submission.create({
      user: req.user._id,
      problem: problem._id,
      contest: contest?._id ?? null,
      language,
      code,
      verdict: 'pending',
      totalTests: problem.testCases.length,
    });

    await Problem.updateOne({ _id: problem._id }, { $inc: { 'stats.submissions': 1 } });

    try {
      await enqueueSubmission(submission._id);
    } catch (queueErr) {
      // The submission row exists but nothing will pick it up — say so plainly
      // rather than leaving the client polling a job that does not exist.
      submission.verdict = 'internal_error';
      submission.failureDetail = { stderr: 'Judge queue unavailable.' };
      await submission.save();
      throw new ApiError(503, 'Judge queue is unavailable. Please retry shortly.', {
        cause: queueErr.message,
      });
    }

    res.status(202).json({ submission: submission.toPublic() });
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  problemId: z.string().refine(mongoose.isValidObjectId).optional(),
  contestId: z.string().refine(mongoose.isValidObjectId).optional(),
  verdict: z.string().optional(),
  mine: z.coerce.boolean().default(true),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

router.get('/', requireAuth, validate(listQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { problemId, contestId, verdict, mine, page, limit } = req.validatedQuery;

    const filter = {};
    // Non-admins can only ever read their own submissions.
    if (mine || req.user.role !== 'admin') filter.user = req.user._id;
    if (problemId) filter.problem = problemId;
    if (contestId) filter.contest = contestId;
    if (verdict) filter.verdict = verdict;

    const [submissions, total] = await Promise.all([
      Submission.find(filter)
        .populate('problem', 'slug title difficulty')
        .populate('contest', 'slug title')
        .populate('user', 'handle')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Submission.countDocuments(filter),
    ]);

    res.json({
      submissions: submissions.map((s) => s.toPublic()),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/queue', requireAuth, async (_req, res, next) => {
  try {
    res.json({ counts: await queueDepth() });
  } catch (err) {
    next(err);
  }
});

async function loadOwnSubmission(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Malformed submission id.');
  const submission = await Submission.findById(req.params.id)
    .populate('problem', 'slug title difficulty statement')
    .populate('user', 'handle');
  if (!submission) throw new ApiError(404, 'Submission not found.');

  const ownerId = submission.user?._id ?? submission.user;
  if (String(ownerId) !== String(req.user._id) && req.user.role !== 'admin') {
    throw new ApiError(403, 'You can only view your own submissions.');
  }
  return submission;
}

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const submission = await loadOwnSubmission(req);
    res.json({ submission: submission.toPublic({ includeCode: true }) });
  } catch (err) {
    next(err);
  }
});

export default router;
