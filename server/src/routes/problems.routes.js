import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Problem, DIFFICULTIES } from '../models/Problem.js';
import { Submission } from '../models/Submission.js';
import { ApiError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

const listQuerySchema = z.object({
  difficulty: z.enum(DIFFICULTIES).optional(),
  topic: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['solved', 'unsolved', 'attempted']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/', optionalAuth, validate(listQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { difficulty, topic, search, status, page, limit } = req.validatedQuery;

    const filter = { isPublished: true };
    if (difficulty) filter.difficulty = difficulty;
    if (topic) filter.topics = topic;
    if (search) filter.title = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    if (status && req.user) {
      const [solved, attempted] = await Promise.all([
        Submission.distinct('problem', { user: req.user._id, verdict: 'accepted' }),
        Submission.distinct('problem', { user: req.user._id }),
      ]);
      if (status === 'solved') filter._id = { $in: solved };
      if (status === 'unsolved') filter._id = { $nin: attempted };
      if (status === 'attempted') {
        const solvedSet = new Set(solved.map(String));
        filter._id = { $in: attempted.filter((id) => !solvedSet.has(String(id))) };
      }
    }

    const [problems, total] = await Promise.all([
      Problem.find(filter)
        .select('-testCases')
        .sort({ difficulty: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Problem.countDocuments(filter),
    ]);

    let statusByProblem = {};
    if (req.user && problems.length) {
      const ids = problems.map((p) => p._id);
      const rows = await Submission.aggregate([
        { $match: { user: req.user._id, problem: { $in: ids } } },
        { $group: { _id: '$problem', accepted: { $max: { $eq: ['$verdict', 'accepted'] } } } },
      ]);
      statusByProblem = Object.fromEntries(
        rows.map((r) => [r._id.toString(), r.accepted ? 'solved' : 'attempted'])
      );
    }

    res.json({
      problems: problems.map((p) => ({
        id: p._id.toString(),
        slug: p.slug,
        title: p.title,
        difficulty: p.difficulty,
        topics: p.topics,
        points: p.points,
        stats: p.stats,
        acceptanceRate: p.stats.submissions
          ? Math.round((p.stats.accepted / p.stats.submissions) * 100)
          : null,
        userStatus: statusByProblem[p._id.toString()] ?? 'none',
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/topics', async (_req, res, next) => {
  try {
    const topics = await Problem.distinct('topics', { isPublished: true });
    res.json({ topics: topics.filter(Boolean).sort() });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', optionalAuth, async (req, res, next) => {
  try {
    const problem = await Problem.findOne({ slug: req.params.slug.toLowerCase() });
    if (!problem) throw new ApiError(404, 'Problem not found.');

    // Unpublished drafts are visible to admins only.
    if (!problem.isPublished && req.user?.role !== 'admin') {
      throw new ApiError(404, 'Problem not found.');
    }

    let userStatus = 'none';
    if (req.user) {
      const mine = await Submission.find({ user: req.user._id, problem: problem._id })
        .select('verdict')
        .lean();
      if (mine.some((s) => s.verdict === 'accepted')) userStatus = 'solved';
      else if (mine.length) userStatus = 'attempted';
    }

    res.json({ problem: { ...problem.toPublic(), userStatus } });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug/submissions', optionalAuth, async (req, res, next) => {
  try {
    if (!req.user) throw new ApiError(401, 'Authentication required.');
    const problem = await Problem.findOne({ slug: req.params.slug.toLowerCase() }).select('_id');
    if (!problem) throw new ApiError(404, 'Problem not found.');

    const submissions = await Submission.find({ user: req.user._id, problem: problem._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ submissions: submissions.map((s) => s.toPublic()) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/insights', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Malformed problem id.');
    const rows = await Submission.aggregate([
      { $match: { problem: new mongoose.Types.ObjectId(req.params.id) } },
      { $group: { _id: '$verdict', count: { $sum: 1 } } },
    ]);
    res.json({ verdictBreakdown: rows.map((r) => ({ verdict: r._id, count: r.count })) });
  } catch (err) {
    next(err);
  }
});

export default router;
