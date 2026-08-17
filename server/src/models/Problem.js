import mongoose from 'mongoose';

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const DIFFICULTY_POINTS = { easy: 100, medium: 250, hard: 500 };

const testCaseSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    expectedOutput: { type: String, required: true },
    // Sample cases are shown on the problem page; the rest are never sent to clients.
    isSample: { type: Boolean, default: false },
  },
  { _id: true }
);

const problemSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    statement: { type: String, required: true },
    inputFormat: { type: String, default: '' },
    outputFormat: { type: String, default: '' },
    constraints: { type: String, default: '' },
    difficulty: { type: String, enum: DIFFICULTIES, required: true, index: true },
    topics: { type: [String], default: [], index: true },
    points: { type: Number, default: 100 },
    timeLimitMs: { type: Number, default: 2000, min: 200, max: 15_000 },
    memoryLimitMb: { type: Number, default: 256, min: 32, max: 1024 },
    testCases: { type: [testCaseSchema], default: [] },
    isPublished: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    stats: {
      submissions: { type: Number, default: 0 },
      accepted: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

problemSchema.index({ title: 'text', statement: 'text' });

problemSchema.pre('validate', function assignPoints(next) {
  if (this.isModified('difficulty') && !this.isModified('points')) {
    this.points = DIFFICULTY_POINTS[this.difficulty] ?? 100;
  }
  next();
});

/** Client-safe projection — hidden test cases never leave the server. */
problemSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    slug: this.slug,
    title: this.title,
    statement: this.statement,
    inputFormat: this.inputFormat,
    outputFormat: this.outputFormat,
    constraints: this.constraints,
    difficulty: this.difficulty,
    topics: this.topics,
    points: this.points,
    timeLimitMs: this.timeLimitMs,
    memoryLimitMb: this.memoryLimitMb,
    samples: this.testCases
      .filter((tc) => tc.isSample)
      .map((tc) => ({ input: tc.input, expectedOutput: tc.expectedOutput })),
    totalTests: this.testCases.length,
    stats: this.stats,
  };
};

export const Problem = mongoose.model('Problem', problemSchema);
