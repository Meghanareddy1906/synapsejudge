import mongoose from 'mongoose';

export const VERDICTS = [
  'pending',
  'running',
  'accepted',
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'runtime_error',
  'compilation_error',
  'internal_error',
];

export const FAILED_VERDICTS = [
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'runtime_error',
  'compilation_error',
];

const testResultSchema = new mongoose.Schema(
  {
    index: Number,
    verdict: String,
    timeMs: Number,
    memoryKb: Number,
    isSample: Boolean,
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    problem: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true, index: true },
    // Set only when the submission was made from inside a live arena. Practice
    // submissions on the same problem stay null and never touch standings.
    contest: { type: mongoose.Schema.Types.ObjectId, ref: 'Contest', default: null, index: true },
    language: { type: String, required: true },
    code: { type: String, required: true, maxlength: 100_000 },
    verdict: { type: String, enum: VERDICTS, default: 'pending', index: true },

    passedTests: { type: Number, default: 0 },
    totalTests: { type: Number, default: 0 },
    maxTimeMs: { type: Number, default: 0 },
    maxMemoryKb: { type: Number, default: 0 },
    testResults: { type: [testResultSchema], default: [] },

    // Only ever populated from the *first failing* test case, and only for
    // compile errors / stderr — never the expected output of a hidden test.
    failureDetail: {
      testIndex: Number,
      stderr: String,
      compileOutput: String,
      input: String,
      expectedOutput: String,
      actualOutput: String,
      isSample: Boolean,
    },

    // 256-dim L2-normalised code embedding, used for plagiarism comparison.
    embedding: { type: [Number], default: undefined, select: false },

    judgedAt: Date,
  },
  { timestamps: true }
);

submissionSchema.index({ problem: 1, verdict: 1, createdAt: -1 });
submissionSchema.index({ user: 1, createdAt: -1 });
// Standings read every submission for one contest, filtered by problem and time.
submissionSchema.index({ contest: 1, problem: 1, createdAt: 1 });

submissionSchema.methods.toPublic = function toPublic({ includeCode = false } = {}) {
  const failure = this.failureDetail ?? {};
  return {
    id: this._id.toString(),
    user: this.populated('user') ? { id: this.user._id, handle: this.user.handle } : this.user,
    problem: this.populated('problem')
      ? { id: this.problem._id, slug: this.problem.slug, title: this.problem.title }
      : this.problem,
    contest: this.populated('contest')
      ? { id: this.contest._id, slug: this.contest.slug, title: this.contest.title }
      : this.contest,
    language: this.language,
    verdict: this.verdict,
    passedTests: this.passedTests,
    totalTests: this.totalTests,
    maxTimeMs: this.maxTimeMs,
    maxMemoryKb: this.maxMemoryKb,
    testResults: this.testResults,
    createdAt: this.createdAt,
    judgedAt: this.judgedAt,
    ...(includeCode ? { code: this.code } : {}),
    failure: {
      testIndex: failure.testIndex,
      compileOutput: failure.compileOutput,
      stderr: failure.stderr,
      // Sample I/O is public; hidden-test I/O is withheld from the response.
      ...(failure.isSample
        ? {
            input: failure.input,
            expectedOutput: failure.expectedOutput,
            actualOutput: failure.actualOutput,
          }
        : {}),
    },
  };
};

export const Submission = mongoose.model('Submission', submissionSchema);
