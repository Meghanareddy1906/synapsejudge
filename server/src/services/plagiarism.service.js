import { Submission } from '../models/Submission.js';
import { PlagiarismFlag } from '../models/PlagiarismFlag.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { embedCode, cosineSimilarity } from './embedding.service.js';

// Comparing against every historical submission is O(n) per judge; cap the window.
const COMPARISON_WINDOW = 300;

/**
 * Embeds an accepted submission and compares it against other users' accepted
 * submissions for the same problem.
 *
 * Anything above the threshold is written as a *flag for human review* — the
 * system never sanctions anyone on its own. Cosine similarity on code is a
 * signal, not a verdict: two correct solutions to an easy problem legitimately
 * look alike, which is exactly why a moderator sees the pair side by side.
 */
export async function analyseForPlagiarism(submission) {
  try {
    const embedding = await embedCode(submission.code);

    await Submission.updateOne({ _id: submission._id }, { $set: { embedding } });

    const peers = await Submission.find({
      problem: submission.problem,
      verdict: 'accepted',
      user: { $ne: submission.user },
      _id: { $ne: submission._id },
    })
      .select('+embedding user createdAt')
      .sort({ createdAt: -1 })
      .limit(COMPARISON_WINDOW)
      .lean();

    const flagged = [];

    for (const peer of peers) {
      if (!peer.embedding?.length) continue;

      const similarity = cosineSimilarity(embedding, peer.embedding);
      if (similarity < env.plagiarismThreshold) continue;

      // Order the pair deterministically so the unique index actually dedupes.
      const [a, b] =
        String(submission._id) < String(peer._id)
          ? [{ id: submission._id, user: submission.user }, { id: peer._id, user: peer.user }]
          : [{ id: peer._id, user: peer.user }, { id: submission._id, user: submission.user }];

      const flag = await PlagiarismFlag.findOneAndUpdate(
        { submissionA: a.id, submissionB: b.id },
        {
          $setOnInsert: {
            problem: submission.problem,
            submissionA: a.id,
            submissionB: b.id,
            userA: a.user,
            userB: b.user,
            similarity: Number(similarity.toFixed(4)),
            method: `cosine:${env.embeddingProvider}`,
            status: 'pending_review',
          },
        },
        { upsert: true, new: true }
      );

      flagged.push(flag);
    }

    if (flagged.length) {
      logger.warn(
        `plagiarism: submission ${submission._id} raised ${flagged.length} flag(s) for review`
      );
    }

    return flagged;
  } catch (err) {
    // Never let similarity analysis affect the verdict the student sees.
    logger.error('plagiarism analysis failed:', err);
    return [];
  }
}
