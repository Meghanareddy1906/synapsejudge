import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Countdown from '../components/Countdown.jsx';
import { formatDateTime } from '../utils/time.js';

// The dashboard is the "is anything happening right now" page, so it refreshes
// itself. 20s is slow enough that an idle open tab costs almost nothing.
const REFRESH_MS = 20_000;

function ActivityChart({ points }) {
  if (!points.length) return <p className="faint">No submissions in the last 7 days.</p>;

  const max = Math.max(...points.map((p) => p.total), 1);

  return (
    <div className="activity">
      {points.map((point) => {
        const rejected = point.total - point.accepted;
        return (
          <div className="activity-row" key={point.date}>
            <span className="activity-date faint">{point.date.slice(5)}</span>
            <div className="activity-bar" title={`${point.accepted} accepted / ${point.total} total`}>
              <div
                className="activity-accepted"
                style={{ width: `${(point.accepted / max) * 100}%` }}
              />
              <div
                className="activity-rejected"
                style={{ width: `${(rejected / max) * 100}%` }}
              />
            </div>
            <span className="activity-count num faint">
              {point.accepted}/{point.total}
            </span>
          </div>
        );
      })}
      <div className="row activity-legend faint">
        <span><i className="swatch swatch-ok" /> accepted</span>
        <span><i className="swatch swatch-err" /> rejected</span>
      </div>
    </div>
  );
}

function ArenaRow({ contest }) {
  return (
    <div className="spread arena-row">
      <div>
        <Link to={`/arenas/${contest.slug}`} style={{ fontWeight: 600 }}>
          {contest.title}
        </Link>
        <div className="faint">
          {contest.problemCount} problems · {contest.participantCount} participants ·{' '}
          {formatDateTime(contest.startAt)}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {contest.status === 'live' ? (
          <Countdown target={contest.endAt} label="Ends in" />
        ) : (
          <Countdown target={contest.startAt} label="Starts in" />
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [top, setTop] = useState([]);
  const [contests, setContests] = useState([]);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      get('/leaderboard/stats'),
      get('/leaderboard?limit=5'),
      get('/contests?limit=20'),
    ])
      .then(([statsRes, boardRes, contestRes]) => {
        setStats(statsRes);
        setTop(boardRes.leaderboard);
        setContests(contestRes.contests);
        setUpdatedAt(new Date());
        setError('');
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const live = contests.filter((c) => c.status === 'live');
  const upcoming = contests.filter((c) => c.status === 'upcoming').slice(0, 3);

  return (
    <>
      <div className="spread" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>
            {user ? `Welcome back, ${user.handle}` : 'SynapseJudge'}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Solve problems, get judged in an isolated container, climb the board.
          </p>
        </div>
        <div className="row">
          <Link to="/arenas" className="btn">
            Arenas
          </Link>
          <Link to="/problems" className="btn btn-primary">
            Browse problems
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {live.length > 0 && (
        <div className="card card-live">
          <div className="card-header">
            <h2>
              <span className="live-dot" aria-hidden="true" /> Live now
            </h2>
            <Link to="/arenas" className="faint">
              All arenas →
            </Link>
          </div>
          <div className="stack">
            {live.map((c) => (
              <ArenaRow key={c.id} contest={c} />
            ))}
          </div>
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-4" style={{ margin: '1rem 0' }}>
            <div className="stat">
              <div className="stat-label">Problems</div>
              <div className="stat-value num">{stats.totals.problems}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Submissions</div>
              <div className="stat-value num">{stats.totals.submissions}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Acceptance</div>
              <div className="stat-value num">{stats.totals.acceptanceRate}%</div>
            </div>
            <div className="stat">
              <div className="stat-label">Registered users</div>
              <div className="stat-value num">{stats.totals.users}</div>
            </div>
          </div>

          {user && (
            <div className="grid grid-4" style={{ marginBottom: '1rem' }}>
              <div className="stat">
                <div className="stat-label">Your solved</div>
                <div className="stat-value num">{user.solvedCount}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Your points</div>
                <div className="stat-value num">{user.points}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Live arenas</div>
                <div className="stat-value num">{stats.totals.liveContests ?? 0}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Accepted overall</div>
                <div className="stat-value num">{stats.totals.accepted}</div>
              </div>
            </div>
          )}

          <div className="split">
            <div className="card">
              <div className="card-header">
                <h2>Activity — last 7 days</h2>
              </div>
              <ActivityChart points={stats.last7Days} />
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Top solvers</h2>
                <Link to="/leaderboard" className="faint">
                  Full leaderboard →
                </Link>
              </div>
              {top.length === 0 ? (
                <p className="faint">Nobody has solved anything yet. Be first.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {top.map((row) => (
                      <tr key={row.userId}>
                        <td className="num" style={{ width: 40 }}>
                          #{row.rank}
                        </td>
                        <td>{row.handle}</td>
                        <td className="num muted">{row.solvedCount} solved</td>
                        <td className="num" style={{ textAlign: 'right' }}>
                          {row.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="split">
            <div className="card">
              <div className="card-header">
                <h2>Upcoming arenas</h2>
                <Link to="/arenas" className="faint">
                  See all →
                </Link>
              </div>
              {upcoming.length === 0 ? (
                <p className="faint">Nothing scheduled right now.</p>
              ) : (
                <div className="stack">
                  {upcoming.map((c) => (
                    <ArenaRow key={c.id} contest={c} />
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <h2>Problems by difficulty</h2>
              </div>
              <div className="row">
                {stats.byDifficulty.map((d) => (
                  <span key={d.difficulty} className={`badge badge-${d.difficulty}`}>
                    {d.difficulty}: {d.count}
                  </span>
                ))}
              </div>
              {updatedAt && (
                <p className="faint" style={{ marginTop: '1rem', marginBottom: 0 }}>
                  Auto-refreshing · last updated {updatedAt.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
