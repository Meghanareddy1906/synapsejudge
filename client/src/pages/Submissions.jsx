import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api/client.js';
import VerdictBadge from '../components/VerdictBadge.jsx';

export default function Submissions() {
  const [submissions, setSubmissions] = useState([]);
  const [verdict, setVerdict] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (verdict) params.set('verdict', verdict);

    setLoading(true);
    get(`/submissions?${params}`)
      .then((res) => {
        setSubmissions(res.submissions);
        setPagination(res.pagination);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [verdict, page]);

  return (
    <>
      <h1>My submissions</h1>

      <div className="toolbar">
        <select
          value={verdict}
          onChange={(e) => {
            setVerdict(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by verdict"
        >
          <option value="">All verdicts</option>
          <option value="accepted">Accepted</option>
          <option value="wrong_answer">Wrong Answer</option>
          <option value="time_limit_exceeded">Time Limit Exceeded</option>
          <option value="runtime_error">Runtime Error</option>
          <option value="compilation_error">Compilation Error</option>
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="empty">
            <span className="spinner" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="empty">
            Nothing here yet. <Link to="/problems">Pick a problem</Link>.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Verdict</th>
                  <th>Language</th>
                  <th className="num">Tests</th>
                  <th className="num">Time</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/problems/${s.problem?.slug}`}>{s.problem?.title ?? '—'}</Link>
                    </td>
                    <td>
                      <Link to={`/submissions/${s.id}`}>
                        <VerdictBadge verdict={s.verdict} />
                      </Link>
                    </td>
                    <td className="muted">{s.language}</td>
                    <td className="num muted">
                      {s.passedTests}/{s.totalTests}
                    </td>
                    <td className="num muted">{s.maxTimeMs ? `${s.maxTimeMs} ms` : '—'}</td>
                    <td className="faint">{new Date(s.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination.pages > 1 && (
        <div className="row" style={{ marginTop: '1rem', justifyContent: 'center' }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className="faint">
            Page {page} of {pagination.pages}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={page >= pagination.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
