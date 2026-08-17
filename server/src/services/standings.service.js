import mongoose from 'mongoose';
import { Submission } from '../models/Submission.js';
import { User } from '../models/User.js';

/**
 * Computes ICPC-style standings for one contest.
 *
 * Rules implemented:
 *  - A problem scores its contest-local points on the *first* accepted
 *    submission, and only if that submission landed inside the window.
 *  - Penalty = minutes elapsed from contest start to the accepted submission,
 *    plus `penaltyMinutes` for each rejected attempt made *before* it.
 *    Attempts after the solve are free — there is nothing left to gain.
 *  - Pending/running submissions count as neither: they are not yet a verdict,
 *    and treating them as wrong would penalise a slow judge queue.
 *  - Ranking is score descending, then penalty ascending, then the time of the
 *    last solve ascending, so a tie is broken by who got there first.
 *
 * Submissions are grouped in Mongo and reduced in JS. The alternative — doing
 * the "count rejections before the first AC" window entirely in an aggregation
 * pipeline — is significantly harder to read for no gain at contest scale.
 */
export async function computeStandings(contest) {
  const problemPoints = new Map(
    contest.problems.map((entry) => [String(entry.problem?._id ?? entry.problem), entry])
  );
  const problemIds = contest.problems.map((entry) =>
    new mongoose.Types.ObjectId(String(entry.problem?._id ?? entry.problem))
  );

  if (problemIds.length === 0) return { rows: [], problems: [] };

  const grouped = await Submission.aggregate([
    {
      $match: {
        contest: contest._id,
        problem: { $in: problemIds },
        createdAt: { $gte: contest.startAt, $lte: contest.endAt },
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: { user: '$user', problem: '$problem' },
        attempts: { $push: { verdict: '$verdict', at: '$createdAt' } },
      },
    },
  ]);

  const byUser = new Map();

  for (const row of grouped) {
    const userId = String(row._id.user);
    const problemId = String(row._id.problem);
    const entry = problemPoints.get(problemId);
    if (!entry) continue;

    let rejectedBefore = 0;
    let solvedAt = null;

    for (const attempt of row.attempts) {
      if (attempt.verdict === 'accepted') {
        solvedAt = attempt.at;
        break;
      }
      // 'pending' / 'running' have no verdict yet, and internal_error is the
      // judge's fault — neither should cost the competitor a penalty.
      if (attempt.verdict !== 'pending' && attempt.verdict !== 'running' && attempt.verdict !== 'internal_error') {
        rejectedBefore += 1;
      }
    }

    if (!byUser.has(userId)) {
      byUser.set(userId, { userId, score: 0, penalty: 0, lastSolvedAt: null, problems: {} });
    }
    const agg = byUser.get(userId);

    if (solvedAt) {
      const minutes = Math.max(0, Math.floor((solvedAt - contest.startAt) / 60_000));
      const penalty = minutes + rejectedBefore * contest.penaltyMinutes;

      agg.score += entry.points;
      agg.penalty += penalty;
      if (!agg.lastSolvedAt || solvedAt > agg.lastSolvedAt) agg.lastSolvedAt = solvedAt;
      agg.problems[problemId] = {
        solved: true,
        attempts: rejectedBefore + 1,
        minutes,
        penalty,
      };
    } else {
      agg.problems[problemId] = { solved: false, attempts: rejectedBefore, minutes: null, penalty: 0 };
    }
  }

  // Registered-but-inactive participants still belong on the board at 0 —
  // an empty row is a truer picture of a contest than a missing one.
  for (const participant of contest.participants) {
    const userId = String(participant.user?._id ?? participant.user);
    if (!byUser.has(userId)) {
      byUser.set(userId, { userId, score: 0, penalty: 0, lastSolvedAt: null, problems: {} });
    }
  }

  const ids = [...byUser.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const users = await User.find({ _id: { $in: ids } }).select('handle rating').lean();
  const handles = new Map(users.map((u) => [String(u._id), u]));

  const rows = [...byUser.values()]
    .filter((row) => handles.has(row.userId))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.penalty - b.penalty ||
        (a.lastSolvedAt ?? Infinity) - (b.lastSolvedAt ?? Infinity)
    )
    .map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      handle: handles.get(row.userId).handle,
      rating: handles.get(row.userId).rating,
      score: row.score,
      penalty: row.penalty,
      solvedCount: Object.values(row.problems).filter((p) => p.solved).length,
      problems: row.problems,
    }));

  return { rows };
}
