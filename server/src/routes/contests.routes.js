import { Router } from 'express';
import { z } from 'zod';
import { Contest } from '../models/Contest.js';
import { Submission } from '../models/Submission.js';
import { ApiError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { computeStandings } from '../services/standings.service.js';

const router = Router();

const listQuerySchema = z.object({
  status: z.enum(['live', 'upcoming', 'past', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Loads a published contest by slug, or 404s. Drafts are admin-only. */
async function loadContest(req, { populateProblems = false } = {}) {
  const query = Contest.findOne({ slug: req.params.slug.toLowerCase() });
  if (populateProblems) query.populate('problems.problem', 'slug title difficulty timeLimitMs memoryLimitMb');

  const contest = await query;
  if (!contest) throw new ApiError(404, 'Arena not found.');
  if (!contest.isPublished && req.user?.role !== 'admin') {
    throw new ApiError(404, 'Arena not found.');
  }
  return contest;
}

router.get('/', optionalAuth, validate(listQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { status, limit } = req.validatedQuery;
    const now = new Date();

    const filter = { isPublished: true };
    if (status === 'live') Object.assign(filter, { startAt: { $lte: now }, endAt: { $gte: now } });
    if (status === 'upcoming') filter.startAt = { $gt: now };
    if (status === 'past') filter.endAt = { $lt: now };

    const contests = await Contest.find(filter).sort({ startAt: -1 }).limit(limit);

    res.json({ contests: contests.map((c) => c.toPublic({ user: req.user })) });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug', optionalAuth, async (req, res, next) => {
  try {
    const contest = await loadContest(req, { populateProblems: true });
    const payload = contest.toPublic({ user: req.user });

    if (!contest.problemsVisibleTo(req.user)) {
      // The count is public — knowing there are six problems tells you nothing.
      return res.json({ contest: { ...payload, problems: null } });
    }

    let solved = new Set();
    let attempted = new Set();
    if (req.user) {
      const rows = await Submission.aggregate([
        { $match: { contest: contest._id, user: req.user._id } },
        {
          $group: {
            _id: '$problem',
            accepted: { $max: { $eq: ['$verdict', 'accepted'] } },
          },
        },
      ]);
      solved = new Set(rows.filter((r) => r.accepted).map((r) => String(r._id)));
      attempted = new Set(rows.map((r) => String(r._id)));
    }

    const problems = contest.problems
      .filter((entry) => entry.problem)
      .map((entry) => {
        const id = String(entry.problem._id);
        return {
          id,
          label: entry.label,
          points: entry.points,
          slug: entry.problem.slug,
          title: entry.problem.title,
          difficulty: entry.problem.difficulty,
          userStatus: solved.has(id) ? 'solved' : attempted.has(id) ? 'attempted' : 'none',
        };
      });

    res.json({ contest: { ...payload, problems } });
  } catch (err) {
    next(err);
  }
});

/**
 * Registration is open until the contest ends, so somebody who finds the arena
 * halfway through can still join — they just start with the clock already
 * running against them.
 */
router.post('/:slug/register', requireAuth, async (req, res, next) => {
  try {
    const contest = await loadContest(req);
    if (contest.statusAt() === 'ended') {
      throw new ApiError(409, 'This arena has already finished.');
    }

    const already = contest.participants.some((p) => String(p.user) === String(req.user._id));
    if (!already) {
      contest.participants.push({ user: req.user._id, registeredAt: new Date() });
      await contest.save();
    }

    res.json({ contest: contest.toPublic({ user: req.user }), registered: true, already });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug/standings', optionalAuth, async (req, res, next) => {
  try {
    const contest = await loadContest(req, { populateProblems: true });

    const problems = contest.problems
      .filter((entry) => entry.problem)
      .map((entry) => ({
        id: String(entry.problem._id),
        label: entry.label,
        points: entry.points,
        slug: entry.problem.slug,
        title: entry.problem.title,
      }));

    // Before the start there is nothing to rank and the problem set is secret.
    if (contest.statusAt() === 'upcoming') {
      return res.json({ status: 'upcoming', problems: [], standings: [] });
    }

    const { rows } = await computeStandings(contest);

    res.json({
      status: contest.statusAt(),
      penaltyMinutes: contest.penaltyMinutes,
      problems,
      standings: rows,
      generatedAt: new Date(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:slug/my-submissions', requireAuth, async (req, res, next) => {
  try {
    const contest = await loadContest(req);
    const submissions = await Submission.find({ contest: contest._id, user: req.user._id })
      .populate('problem', 'slug title difficulty')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ submissions: submissions.map((s) => s.toPublic()) });
  } catch (err) {
    next(err);
  }
});

export { loadContest };
export default router;
