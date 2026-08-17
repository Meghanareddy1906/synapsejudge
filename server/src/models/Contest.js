import mongoose from 'mongoose';

export const CONTEST_STATUSES = ['upcoming', 'live', 'ended'];

/**
 * A contest problem is a *reference* to a published problem plus contest-local
 * scoring. Points are per-contest rather than inherited from the problem so an
 * organiser can weight an easy problem heavily in a beginner arena without
 * changing its value in the global practice leaderboard.
 */
const contestProblemSchema = new mongoose.Schema(
  {
    problem: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    // A, B, C … shown in the standings header. Derived on save if left blank.
    label: { type: String, default: '' },
    points: { type: Number, default: 100, min: 1, max: 10_000 },
  },
  { _id: false }
);

const participantSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    registeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const contestSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: '' },
    rules: { type: String, default: '' },

    startAt: { type: Date, required: true, index: true },
    endAt: {
      type: Date,
      required: true,
      // A schema validator rather than a throw in pre('validate'): this surfaces
      // as a mongoose ValidationError, which the error handler already maps to a
      // 400. A bare Error would fall through to a 500 for a bad input.
      validate: {
        validator(value) {
          return !this.startAt || value > this.startAt;
        },
        message: 'Contest end time must be after its start time.',
      },
    },

    problems: { type: [contestProblemSchema], default: [] },
    participants: { type: [participantSchema], default: [] },

    // ICPC-style: each rejected attempt made *before* the accepted one adds this
    // many minutes to the penalty. Penalty only ever breaks ties on score.
    penaltyMinutes: { type: Number, default: 20, min: 0, max: 120 },

    isPublished: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

contestSchema.index({ startAt: -1, isPublished: 1 });

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

contestSchema.pre('validate', function assignLabels(next) {
  this.problems.forEach((entry, index) => {
    if (!entry.label) entry.label = LABELS[index] ?? String(index + 1);
  });
  next();
});

contestSchema.methods.statusAt = function statusAt(now = new Date()) {
  if (now < this.startAt) return 'upcoming';
  if (now > this.endAt) return 'ended';
  return 'live';
};

/**
 * Problems are withheld until the contest starts. Returning them early would
 * let anyone read the set, prepare offline and submit the instant it opens —
 * which defeats the point of a timed arena.
 */
contestSchema.methods.problemsVisibleTo = function problemsVisibleTo(user) {
  return this.statusAt() !== 'upcoming' || user?.role === 'admin';
};

contestSchema.methods.toPublic = function toPublic({ user = null } = {}) {
  const status = this.statusAt();
  return {
    id: this._id.toString(),
    slug: this.slug,
    title: this.title,
    description: this.description,
    rules: this.rules,
    startAt: this.startAt,
    endAt: this.endAt,
    durationMinutes: Math.round((this.endAt - this.startAt) / 60_000),
    status,
    penaltyMinutes: this.penaltyMinutes,
    problemCount: this.problems.length,
    participantCount: this.participants.length,
    isPublished: this.isPublished,
    registered: user
      ? this.participants.some((p) => String(p.user?._id ?? p.user) === String(user._id))
      : false,
  };
};

export const Contest = mongoose.model('Contest', contestSchema);
