import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api/client.js';
import Countdown from '../components/Countdown.jsx';
import { formatDateTime, formatLength } from '../utils/time.js';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Finished' },
];

function ArenaCard({ contest, onExpire }) {
  return (
    <div className={`arena-card arena-${contest.status}`}>
      <div className="spread">
        <div>
          <div className="row">
            <span className={`badge badge-status-${contest.status}`}>
              {contest.status === 'live' ? '● Live' : contest.status === 'upcoming' ? 'Upcoming' : 'Finished'}
            </span>
            <span className="badge badge-neutral">{formatLength(contest.durationMinutes)}</span>
            {contest.registered && <span className="badge badge-accent">registered</span>}
          </div>
          <h2 style={{ margin: '0.6rem 0 0.2rem' }}>
            <Link to={`/arenas/${contest.slug}`}>{contest.title}</Link>
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {contest.description || 'No description provided.'}
          </p>
        </div>

        <div className="arena-card-clock">
          {contest.status === 'live' && (
            <Countdown target={contest.endAt} onExpire={onExpire} label="Ends in" />
          )}
          {contest.status === 'upcoming' && (
            <Countdown target={contest.startAt} onExpire={onExpire} label="Starts in" />
          )}
          {contest.status === 'ended' && (
            <span className="faint">Ended {formatDateTime(contest.endAt)}</span>
          )}
        </div>
      </div>

      <div className="spread" style={{ marginTop: '0.9rem' }}>
        <span className="faint">
          {contest.problemCount} problems · {contest.participantCount} participants ·{' '}
          {formatDateTime(contest.startAt)}
        </span>
        <Link
          to={`/arenas/${contest.slug}`}
          className={`btn btn-sm ${contest.status === 'live' ? 'btn-primary' : ''}`}
        >
          {contest.status === 'live' ? 'Enter arena' : contest.status === 'upcoming' ? 'View details' : 'Standings'}
        </Link>
      </div>
    </div>
  );
}

export default function Arenas() {
  const [tab, setTab] = useState('all');
  const [contests, setContests] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    get(`/contests?status=${tab}&limit=50`)
      .then((res) => setContests(res.contests))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A contest crossing a boundary changes what the page should show, so refetch
  // rather than trying to recompute the status in the browser.
  const refresh = useCallback(() => load(), [load]);

  const grouped =
    tab === 'all'
      ? ['live', 'upcoming', 'ended'].map((status) => ({
          status,
          items: contests.filter((c) => c.status === status),
        }))
      : [{ status: tab, items: contests }];

  return (
    <>
      <div className="spread" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Arenas</h1>
          <p className="muted" style={{ margin: 0 }}>
            Timed contests with ICPC-style scoring and live standings.
          </p>
        </div>
      </div>

      <div className="toolbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="center-page">
          <span className="spinner" />
        </div>
      ) : contests.length === 0 ? (
        <div className="card empty">No arenas here yet. Check the other tabs.</div>
      ) : (
        <div className="stack">
          {grouped.map(({ status, items }) =>
            items.length === 0 ? null : (
              <section key={status}>
                {tab === 'all' && (
                  <h2 className="section-heading">
                    {status === 'live' ? 'Live now' : status === 'upcoming' ? 'Upcoming' : 'Finished'}
                  </h2>
                )}
                <div className="stack">
                  {items.map((contest) => (
                    <ArenaCard key={contest.id} contest={contest} onExpire={refresh} />
                  ))}
                </div>
              </section>
            )
          )}
        </div>
      )}
    </>
  );
}
