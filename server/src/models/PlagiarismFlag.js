import mongoose from 'mongoose';

/**
 * A suspected-similarity pair awaiting human review. The system never issues a
 * verdict on its own — flags are advisory input for a moderator.
 */
const plagiarismFlagSchema = new mongoose.Schema(
  {
    problem: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true, index: true },
    submissionA: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission', required: true },
    submissionB: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission', required: true },
    userA: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    similarity: { type: Number, required: true },
    method: { type: String, default: 'cosine' },
    status: {
      type: String,
      enum: ['pending_review', 'dismissed', 'confirmed'],
      default: 'pending_review',
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: String,
  },
  { timestamps: true }
);

plagiarismFlagSchema.index({ submissionA: 1, submissionB: 1 }, { unique: true });

export const PlagiarismFlag = mongoose.model('PlagiarismFlag', plagiarismFlagSchema);
