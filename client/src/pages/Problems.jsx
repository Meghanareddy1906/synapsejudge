import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_MARK = { solved: '✓', attempted: '•', none: '' };

export default function Problems() {
  const { user } = useAuth();
  const [problems, setProblems] = useState([]);
  const [topics, setTopics] = useState([]);
  const [filters, setFilters] = useState({ difficulty: '', topic: '', search: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/problems/topics')
      .then((res) => setTopics(res.topics))
      .catch(() => setTopics([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Debounce so typing in the search box does not fire a request per keystroke.
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      setLoading(true);
      get(`/problems?${params}`, { signal: controller.signal })
        .then((res) => {
          setProblems(res.problems);
          setError('');
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setError(err.message);
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters]);

  const update = (key) => (event) => setFilters({ ...filters, [key]: event.target.value });

  return (
    <>
      <h1>Problems</h1>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search titles…"
          value={filters.search}
          onChange={update('search')}
          aria-label="Search problems"
        />
        <select value={filters.difficulty} onChange={update('difficulty')} aria-label="Difficulty">
          <option value="">All difficulties</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <select value={filters.topic} onChange={update('topic')} aria-label="Topic">
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {user && (
          <select value={filters.status} onChange={update('status')} aria-label="Status">
            <option value="">Any status</option>
            <option value="solved">Solved</option>
            <option value="attempted">Attempted</option>
            <option value="unsolved">Not attempted</option>
          </select>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="empty">
            <span className="spinner" />
          </div>
        ) : problems.length === 0 ? (
          <div className="empty">No problems match these filters.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {user && <th style={{ width: 36 }} />}
                  <th>Title</th>
                  <th>Difficulty</th>
                  <th>Topics</th>
                  <th className="num">Points</th>
                  <th className="num">Acceptance</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((p) => (
                  <tr key={p.id}>
                    {user && (
                      <td
                        className={p.userStatus === 'solved' ? 'verdict-accepted' : 'muted'}
                        title={p.userStatus}
                      >
                        {STATUS_MARK[p.userStatus]}
                      </td>
                    )}
                    <td>
                      <Link to={`/problems/${p.slug}`}>{p.title}</Link>
                    </td>
                    <td>
                      <span className={`badge badge-${p.difficulty}`}>{p.difficulty}</span>
                    </td>
                    <td className="muted">{p.topics.join(', ') || '—'}</td>
                    <td className="num">{p.points}</td>
                    <td className="num muted">
                      {p.acceptanceRate === null ? '—' : `${p.acceptanceRate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
