import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get } from '../api/client.js';
import VerdictBadge from '../components/VerdictBadge.jsx';

export default function SubmissionDetail() {
  const { id } = useParams();

  const [submission, setSubmission] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get(`/submissions/${id}`)
      .then((res) => setSubmission(res.submission))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!submission) {
    return (
      <div className="center-page">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>
            <Link to={`/problems/${submission.problem?.slug}`}>{submission.problem?.title}</Link>
          </h1>
          <p className="faint" style={{ margin: 0 }}>
            {submission.language} · submitted {new Date(submission.createdAt).toLocaleString()}
          </p>
        </div>
        <VerdictBadge verdict={submission.verdict} />
      </div>

      <div className="grid grid-4" style={{ marginBottom: '1rem' }}>
        <div className="stat">
          <div className="stat-label">Tests passed</div>
          <div className="stat-value num">
            {submission.passedTests}/{submission.totalTests}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Slowest test</div>
          <div className="stat-value num">{submission.maxTimeMs} ms</div>
        </div>
      </div>

      {submission.failure?.compileOutput && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">
            <h2>Compiler output</h2>
          </div>
          <pre>{submission.failure.compileOutput}</pre>
        </div>
      )}

      {submission.failure?.input !== undefined && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">
            <h2>Failing sample test</h2>
          </div>
          <div className="sample-grid">
            <div>
              <div className="faint">Input</div>
              <pre>{submission.failure.input}</pre>
            </div>
            <div>
              <div className="faint">Expected</div>
              <pre>{submission.failure.expectedOutput}</pre>
            </div>
          </div>
          <div className="statement-section">
            <div className="faint">Your output</div>
            <pre>{submission.failure.actualOutput || '(no output)'}</pre>
          </div>
        </div>
      )}

      {submission.failure?.stderr && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">
            <h2>Standard error</h2>
          </div>
          <pre>{submission.failure.stderr}</pre>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>Source</h2>
        </div>
        <pre>{submission.code}</pre>
      </div>
    </>
  );
}
