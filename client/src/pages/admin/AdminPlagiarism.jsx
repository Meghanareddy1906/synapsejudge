import { useEffect, useState } from 'react';
import { get, post } from '../../api/client.js';

const STATUS_BADGE = {
  pending_review: 'badge-medium',
  confirmed: 'badge-hard',
  dismissed: 'badge-neutral',
};

export default function AdminPlagiarism() {
  const [flags, setFlags] = useState([]);
  const [status, setStatus] = useState('pending_review');
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    get(`/admin/plagiarism?status=${status}`)
      .then((res) => {
        setFlags(res.flags);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [status]);

  const open = async (id) => {
    setError('');
    setNote('');
    try {
      setDetail(await get(`/admin/plagiarism/${id}`));
    } catch (err) {
      setError(err.message);
    }
  };

  const review = async (decision) => {
    try {
      await post(`/admin/plagiarism/${detail.flag._id}/review`, {
        status: decision,
        reviewNote: note || undefined,
      });
      setNotice(decision === 'confirmed' ? 'Flag confirmed.' : 'Flag dismissed.');
      setDetail(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  /* -------------------------------- detail -------------------------------- */

  if (detail) {
    const { flag, submissionA, submissionB } = detail;
    return (
      <>
        <div className="spread" style={{ marginBottom: '1rem' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Review flagged pair</h1>
            <p className="faint" style={{ margin: 0 }}>
              {flag.problem?.title} · cosine similarity{' '}
              <strong>{(flag.similarity * 100).toFixed(1)}%</strong> · {flag.method}
            </p>
          </div>
          <button type="button" className="btn" onClick={() => setDetail(null)}>
            Back to list
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="alert alert-info">
          Similarity is a signal, not a verdict. Two correct solutions to an easy problem often look
          alike — read both before deciding.
        </div>

        <div className="split">
          <div className="card">
            <div className="card-header">
              <h2>{flag.userA?.handle}</h2>
              <span className="faint">
                {submissionA?.language} · {new Date(submissionA?.createdAt).toLocaleString()}
              </span>
            </div>
            <pre>{submissionA?.code}</pre>
          </div>
          <div className="card">
            <div className="card-header">
              <h2>{flag.userB?.handle}</h2>
              <span className="faint">
                {submissionB?.language} · {new Date(submissionB?.createdAt).toLocaleString()}
              </span>
            </div>
            <pre>{submissionB?.code}</pre>
          </div>
        </div>

        <div className="card">
          <div className="field">
            <label htmlFor="note">Reviewer note (optional)</label>
            <textarea
              id="note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you conclude, and why?"
            />
          </div>
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={() => review('confirmed')}>
              Confirm plagiarism
            </button>
            <button type="button" className="btn" onClick={() => review('dismissed')}>
              Dismiss — legitimate
            </button>
          </div>
        </div>
      </>
    );
  }

  /* --------------------------------- list --------------------------------- */

  return (
    <>
      <h1>Plagiarism review</h1>
      <p className="muted">
        Submissions are embedded and compared by cosine similarity. Pairs above the configured
        threshold land here for a human decision — nothing is actioned automatically.
      </p>

      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="pending_review">Pending review</option>
          <option value="confirmed">Confirmed</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="card">
        {loading ? (
          <div className="empty">
            <span className="spinner" />
          </div>
        ) : flags.length === 0 ? (
          <div className="empty">Nothing flagged in this bucket.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>Pair</th>
                  <th className="num">Similarity</th>
                  <th>Status</th>
                  <th>Flagged</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {flags.map((flag) => (
                  <tr key={flag._id}>
                    <td>{flag.problem?.title ?? '—'}</td>
                    <td>
                      {flag.userA?.handle} ↔ {flag.userB?.handle}
                    </td>
                    <td className="num">{(flag.similarity * 100).toFixed(1)}%</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[flag.status] ?? 'badge-neutral'}`}>
                        {flag.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="faint">{new Date(flag.createdAt).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-sm" onClick={() => open(flag._id)}>
                        Review
                      </button>
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
