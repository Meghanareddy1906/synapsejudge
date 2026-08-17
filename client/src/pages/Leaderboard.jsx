import { useEffect, useState } from 'react';
import { get } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Leaderboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [since, setSince] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    get(`/leaderboard?since=${since}&limit=100`)
      .then((res) => {
        setRows(res.leaderboard);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [since]);

  return (
    <>
      <h1>Leaderboard</h1>
      <p className="muted">
        Points are awarded once per distinct problem solved — resubmitting an accepted solution does
        not farm the board.
      </p>

      <div className="toolbar">
        <select value={since} onChange={(e) => setSince(e.target.value)} aria-label="Time window">
          <option value="all">All time</option>
          <option value="month">Last 30 days</option>
          <option value="week">Last 7 days</option>
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="empty">
            <span className="spinner" />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">No accepted solutions in this window yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Handle</th>
                  <th className="num">Solved</th>
                  <th className="num">Points</th>
                  <th>Last solve</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isMe = user && row.userId === user.id;
                  return (
                    <tr key={row.userId} style={isMe ? { background: 'var(--bg-elev-2)' } : undefined}>
                      <td className="num">#{row.rank}</td>
                      <td>
                        {row.handle}
                        {isMe && (
                          <span className="badge badge-accent" style={{ marginLeft: 8 }}>
                            you
                          </span>
                        )}
                      </td>
                      <td className="num">{row.solvedCount}</td>
                      <td className="num">{row.points}</td>
                      <td className="faint">
                        {row.lastSolvedAt ? new Date(row.lastSolvedAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
