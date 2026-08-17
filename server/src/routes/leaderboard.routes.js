import { Router } from 'express';
import { z } from 'zod';
import { Submission } from '../models/Submission.js';
import { User } from '../models/User.js';
import { Problem } from '../models/Problem.js';
import { Contest } from '../models/Contest.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  since: z.enum(['all', 'week', 'month']).default('all'),
});

router.get('/', validate(querySchema, 'query'), async (req, res, next) => {
  try {
    const { limit, since } = req.validatedQuery;

    const match = { verdict: 'accepted' };
    if (since !== 'all') {
      const days = since === 'week' ? 7 : 30;
      match.createdAt = { $gte: new Date(Date.now() - days * 86_400_000) };
    }

    // Score each user once per distinct solved problem, not once per AC submission.
    const rows = await Submission.aggregate([
      { $match: match },
      { $group: { _id: { user: '$user', problem: '$problem' }, firstSolved: { $min: '$createdAt' } } },
      {
        $lookup: {
          from: Problem.collection.name,
          localField: '_id.problem',
          foreignField: '_id',
          as: 'problem',
        },
      },
      { $unwind: '$problem' },
      {
        $group: {
          _id: '$_id.user',
          solvedCount: { $sum: 1 },
          points: { $sum: '$problem.points' },
          lastSolvedAt: { $max: '$firstSolved' },
        },
      },
      { $sort: { points: -1, solvedCount: -1, lastSolvedAt: 1 } },
      { $limit: limit },
      {
        $lookup: {
          from: User.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          handle: '$user.handle',
          rating: '$user.rating',
          solvedCount: 1,
          points: 1,
          lastSolvedAt: 1,
        },
      },
    ]);

    res.json({
      window: since,
      leaderboard: rows.map((row, index) => ({ rank: index + 1, ...row })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const now = new Date();
    const [users, problems, submissions, accepted, liveContests, byDifficulty, recent] = await Promise.all([
      User.countDocuments(),
      Problem.countDocuments({ isPublished: true }),
      Submission.countDocuments(),
      Submission.countDocuments({ verdict: 'accepted' }),
      Contest.countDocuments({ isPublished: true, startAt: { $lte: now }, endAt: { $gte: now } }),
      Problem.aggregate([
        { $match: { isPublished: true } },
        { $group: { _id: '$difficulty', count: { $sum: 1 } } },
      ]),
      Submission.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            total: { $sum: 1 },
            accepted: { $sum: { $cond: [{ $eq: ['$verdict', 'accepted'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      totals: {
        users,
        problems,
        submissions,
        accepted,
        liveContests,
        acceptanceRate: submissions ? Math.round((accepted / submissions) * 100) : 0,
      },
      byDifficulty: byDifficulty.map((d) => ({ difficulty: d._id, count: d.count })),
      last7Days: recent.map((d) => ({ date: d._id, total: d.total, accepted: d.accepted })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
