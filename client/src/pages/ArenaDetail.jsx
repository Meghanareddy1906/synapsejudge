import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Countdown from '../components/Countdown.jsx';
import VerdictBadge from '../components/VerdictBadge.jsx';
import { formatDateTime, formatLength } from '../utils/time.js';

// Standings refresh while the arena is live. 15s is frequent enough to feel
// live without every open scoreboard hammering the aggregation.
const STANDINGS_POLL_MS = 15_000;

function StandingsTable({ problems, standings, meId }) {
  if (standings.length === 0) {
    return <p className="faint">No submissions yet — the board fills up as people solve.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="table standings">
        <thead>
          <tr>
            <th style={{ width: 52 }}>#</th>
            <th>Participant</th>
            <th className="num">Score</th>
            <th className="num">Penalty</th>
            {problems.map((p) => (
              <th key={p.id} className="num" title={`${p.title} · ${p.points} pts`}>
                <Link to={`/problems/${p.slug}`}>{p.label}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.userId} className={row.userId === meId ? 'is-me' : undefined}>
              <td className="num">{row.rank}</td>
              <td>
                {row.handle}
                {row.userId === meId && <span className="badge badge-accent" style={{ marginLeft: 8 }}>you</span>}
              </td>
              <td className="num" style={{ fontWeight: 650 }}>{row.score}</td>
              <td className="num muted">{row.penalty}</td>
              {problems.map((p) => {
                const cell = row.problems[p.id];
                if (!cell || (!cell.solved && cell.attempts === 0)) {
                  return <td key={p.id} className="num faint">—</td>;
                }
                return (
                  <td key={p.id} className={`num cell-${cell.solved ? 'solved' : 'failed'}`}>
                    {cell.solved ? (
                      <>
                        <div>+{cell.attempts > 1 ? cell.attempts - 1 : ''}</div>
                        <div className="faint">{cell.minutes}</div>
                      </>
                    ) : (
                      <div>-{cell.attempts}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ArenaDetail() {
  const { slug } = useParams();
  const { user } = useAuth();

  const [contest, setContest] = useState(null);
  const [standings, setStandings] = useState(null);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState('');
  const [registering, setRegistering] = useState(false);
  const pollRef = useRef(null);

  const loadContest = useCallback(
    () => get(`/contests/${slug}`).then((res) => setContest(res.contest)),
    [slug]
  );

  const loadStandings = useCallback(
    () =>
      get(`/contests/${slug}/standings`)
        .then((res) => setStandings(res))
        .catch(() => {}),
    [slug]
  );

  const loadMine = useCallback(() => {
    if (!user) return Promise.resolve();
    return get(`/contests/${slug}/my-submissions`)
      .then((res) => setMine(res.submissions))
      .catch(() => {});
  }, [slug, user]);

  useEffect(() => {
    setError('');
    setContest(null);
    loadContest().catch((err) => setError(err.message));
  }, [loadContest]);

  useEffect(() => {
    loadStandings();
    loadMine();
  }, [loadStandings, loadMine]);

  // Poll only while the arena is actually running.
  useEffect(() => {
    clearInterval(pollRef.current);
    if (contest?.status !== 'live') return undefined;

    pollRef.current = setInterval(() => {
      loadStandings();
      loadMine();
    }, STANDINGS_POLL_MS);

    return () => clearInterval(pollRef.current);
  }, [contest?.status, loadStandings, loadMine]);

  const refreshAll = useCallback(() => {
    loadContest().catch(() => {});
    loadStandings();
    loadMine();
  }, [loadContest, loadStandings, loadMine]);

  const register = async () => {
    setRegistering(true);
    setError('');
    try {
      await post(`/contests/${slug}/register`);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  if (error && !contest) return <div className="alert alert-error">{error}</div>;
  if (!contest) {
    return (
      <div className="center-page">
        <span className="spinner" />
      </div>
    );
  }

  const solvedByMe = new Set(
    (contest.problems ?? []).filter((p) => p.userStatus === 'solved').map((p) => p.id)
  );

  return (
    <>
      <div className={`arena-hero arena-${contest.status}`}>
        <div className="spread">
          <div>
            <div className="row">
              <span className={`badge badge-status-${contest.status}`}>
                {contest.status === 'live' ? '● Live' : contest.status === 'upcoming' ? 'Upcoming' : 'Finished'}
              </span>
              <span className="badge badge-neutral">{formatLength(contest.durationMinutes)}</span>
              <span className="badge badge-neutral">{contest.participantCount} participants</span>
            </div>
            <h1 style={{ margin: '0.6rem 0 0.25rem' }}>{contest.title}</h1>
            <p className="muted" style={{ margin: 0 }}>{contest.description}</p>
            <p className="faint" style={{ margin: '0.4rem 0 0' }}>
              {formatDateTime(contest.startAt)} → {formatDateTime(contest.endAt)}
            </p>
          </div>

          <div className="arena-hero-side">
            {contest.status === 'live' && (
              <Countdown target={contest.endAt} onExpire={refreshAll} label="Time remaining" />
            )}
            {contest.status === 'upcoming' && (
              <Countdown target={contest.startAt} onExpire={refreshAll} label="Starts in" />
            )}
            {contest.status === 'ended' && <span className="faint">Final standings</span>}

            {user && contest.status !== 'ended' && (
              contest.registered ? (
                <span className="badge badge-accent" style={{ marginTop: '0.6rem' }}>
                  You are registered
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={register}
                  disabled={registering}
                  style={{ marginTop: '0.6rem' }}
                >
                  {registering ? 'Registering…' : 'Register'}
                </button>
              )
            )}
            {!user && (
              <Link to="/login" className="btn btn-sm" style={{ marginTop: '0.6rem' }}>
                Sign in to compete
              </Link>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {contest.rules && (
        <div className="card">
          <div className="card-header">
            <h2>Rules</h2>
            <span className="faint">{contest.penaltyMinutes} min penalty per rejected attempt</span>
          </div>
          <div className="statement">{contest.rules}</div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>Problems</h2>
          {contest.problems && <span className="faint">{contest.problems.length} problems</span>}
        </div>

        {contest.problems === null ? (
          <div className="alert alert-info" style={{ marginBottom: 0 }}>
            Problems are revealed when the arena starts.
          </div>
        ) : contest.problems.length === 0 ? (
          <p className="faint">No problems have been added to this arena.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Problem</th>
                  <th>Difficulty</th>
                  <th className="num">Points</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {contest.problems.map((p) => (
                  <tr key={p.id}>
                    <td className="num" style={{ fontWeight: 650 }}>{p.label}</td>
                    <td>
                      <Link to={`/problems/${p.slug}?arena=${contest.slug}`}>{p.title}</Link>
                      {solvedByMe.has(p.id) && (
                        <span className="badge badge-easy" style={{ marginLeft: 8 }}>solved</span>
                      )}
                      {p.userStatus === 'attempted' && (
                        <span className="badge badge-medium" style={{ marginLeft: 8 }}>attempted</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${p.difficulty}`}>{p.difficulty}</span>
                    </td>
                    <td className="num">{p.points}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link
                        to={`/problems/${p.slug}?arena=${contest.slug}`}
                        className={`btn btn-sm ${contest.status === 'live' ? 'btn-primary' : ''}`}
                      >
                        {contest.status === 'live' ? 'Solve' : 'Open'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Standings</h2>
          <span className="faint">
            {contest.status === 'live' ? `Auto-refreshing every ${STANDINGS_POLL_MS / 1000}s` : 'Final'}
          </span>
        </div>

        {!standings || standings.status === 'upcoming' ? (
          <p className="faint">Standings open when the arena starts.</p>
        ) : (
          <StandingsTable
            problems={standings.problems}
            standings={standings.standings}
            meId={user?.id}
          />
        )}
      </div>

      {user && mine.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Your arena submissions</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {mine.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/submissions/${s.id}`}>
                        <VerdictBadge verdict={s.verdict} />
                      </Link>
                    </td>
                    <td>{s.problem?.title ?? '—'}</td>
                    <td className="muted">{s.language}</td>
                    <td className="num muted">
                      {s.passedTests}/{s.totalTests}
                    </td>
                    <td className="faint" style={{ textAlign: 'right' }}>
                      {formatDateTime(s.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
