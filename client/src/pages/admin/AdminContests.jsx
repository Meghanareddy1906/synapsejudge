import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, put, del } from '../../api/client.js';
import { formatDateTime, formatLength } from '../../utils/time.js';

/** `<input type="datetime-local">` wants local wall-clock time, not an ISO Z string. */
function toLocalInput(value) {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date - offset).toISOString().slice(0, 16);
}

function blankForm() {
  const start = new Date(Date.now() + 3_600_000);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return {
    title: '',
    slug: '',
    description: '',
    rules:
      'Solve as many problems as you can before the timer runs out.\nEach problem awards its full points on your first accepted submission.\nEvery rejected attempt before a solve adds penalty minutes. Penalty only breaks ties.',
    startAt: toLocalInput(start),
    endAt: toLocalInput(end),
    penaltyMinutes: 20,
    isPublished: false,
    problems: [],
  };
}

export default function AdminContests() {
  const [contests, setContests] = useState([]);
  const [allProblems, setAllProblems] = useState([]);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    get('/admin/contests')
      .then((res) => setContests(res.contests))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    get('/admin/problems')
      .then((res) => setAllProblems(res.problems))
      .catch(() => {});
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm(blankForm());
    setError('');
    setNotice('');
  };

  const startEdit = async (id) => {
    setError('');
    setNotice('');
    try {
      const { contest } = await get(`/admin/contests/${id}`);
      setEditingId(id);
      setForm({
        title: contest.title,
        slug: contest.slug,
        description: contest.description ?? '',
        rules: contest.rules ?? '',
        startAt: toLocalInput(contest.startAt),
        endAt: toLocalInput(contest.endAt),
        penaltyMinutes: contest.penaltyMinutes ?? 20,
        isPublished: contest.isPublished,
        problems: (contest.problems ?? []).map((entry) => ({
          problem: String(entry.problem?._id ?? entry.problem),
          label: entry.label ?? '',
          points: entry.points ?? 100,
        })),
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        slug: form.slug || undefined,
        description: form.description,
        rules: form.rules,
        // datetime-local has no zone; new Date() reads it as local, which is
        // what the organiser meant, and it serialises to UTC on the wire.
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        penaltyMinutes: Number(form.penaltyMinutes),
        isPublished: form.isPublished,
        problems: form.problems
          .filter((p) => p.problem)
          .map((p) => ({
            problem: p.problem,
            label: p.label || undefined,
            points: Number(p.points) || 100,
          })),
      };

      if (editingId) {
        await put(`/admin/contests/${editingId}`, payload);
        setNotice('Arena updated.');
      } else {
        await post('/admin/contests', payload);
        setNotice('Arena created.');
      }
      setForm(null);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.details?.length ? `${err.message} (${err.details[0].message})` : err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, title) => {
    if (!window.confirm(`Delete "${title}"? Submissions are kept but lose their arena scoring.`)) return;
    try {
      await del(`/admin/contests/${id}`);
      setNotice('Arena deleted.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const updateRow = (index, patch) =>
    setForm({
      ...form,
      problems: form.problems.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });

  /* --------------------------------- form --------------------------------- */

  if (form) {
    return (
      <form className="card" onSubmit={save}>
        <div className="card-header">
          <h1>{editingId ? 'Edit arena' : 'New arena'}</h1>
          <button type="button" className="btn btn-sm" onClick={() => setForm(null)}>
            Cancel
          </button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="field-row">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="slug">Slug (optional)</label>
            <input
              id="slug"
              placeholder="derived from title"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="rules">Rules</label>
          <textarea
            id="rules"
            rows={4}
            value={form.rules}
            onChange={(e) => setForm({ ...form, rules: e.target.value })}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="startAt">Starts at</label>
            <input
              id="startAt"
              type="datetime-local"
              required
              value={form.startAt}
              onChange={(e) => setForm({ ...form, startAt: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="endAt">Ends at</label>
            <input
              id="endAt"
              type="datetime-local"
              required
              value={form.endAt}
              onChange={(e) => setForm({ ...form, endAt: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="penalty">Penalty per rejection (min)</label>
            <input
              id="penalty"
              type="number"
              min={0}
              max={120}
              value={form.penaltyMinutes}
              onChange={(e) => setForm({ ...form, penaltyMinutes: e.target.value })}
            />
          </div>
        </div>

        <div className="card-header" style={{ marginTop: '1rem' }}>
          <h2>Problems</h2>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              setForm({ ...form, problems: [...form.problems, { problem: '', label: '', points: 100 }] })
            }
          >
            Add problem
          </button>
        </div>

        <p className="faint">
          Order sets the labels A, B, C… Points are contest-local and do not change the problem&apos;s
          practice value.
        </p>

        {form.problems.length === 0 && <p className="faint">No problems added yet.</p>}

        {form.problems.map((row, index) => (
          <div className="field-row" key={index} style={{ marginBottom: '0.6rem' }}>
            <div className="field" style={{ flex: '3 1 260px', marginBottom: 0 }}>
              <label>Problem {index + 1}</label>
              <select value={row.problem} onChange={(e) => updateRow(index, { problem: e.target.value })}>
                <option value="">— select a problem —</option>
                {allProblems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.difficulty}){p.isPublished ? '' : ' — draft'}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: '0 1 90px', marginBottom: 0 }}>
              <label>Label</label>
              <input
                maxLength={4}
                placeholder="auto"
                value={row.label}
                onChange={(e) => updateRow(index, { label: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: '0 1 110px', marginBottom: 0 }}>
              <label>Points</label>
              <input
                type="number"
                min={1}
                value={row.points}
                onChange={(e) => updateRow(index, { points: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              style={{ flex: '0 0 auto' }}
              onClick={() =>
                setForm({ ...form, problems: form.problems.filter((_, i) => i !== index) })
              }
            >
              Remove
            </button>
          </div>
        ))}

        <div className="row" style={{ marginTop: '1rem' }}>
          <label style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
              style={{ width: 'auto', marginRight: 6 }}
            />
            Published (visible on the Arenas page)
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save arena'}
          </button>
        </div>
      </form>
    );
  }

  /* --------------------------------- list --------------------------------- */

  return (
    <>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <h1>Manage arenas</h1>
        <button type="button" className="btn btn-primary" onClick={startCreate}>
          New arena
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="card">
        {contests.length === 0 ? (
          <div className="empty">No arenas yet. Create one to run a timed contest.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Starts</th>
                  <th>Length</th>
                  <th className="num">Problems</th>
                  <th className="num">Participants</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contests.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/arenas/${c.slug}`}>{c.title}</Link>
                      <div className="faint">{c.slug}</div>
                    </td>
                    <td>
                      <div className="row">
                        <span className={`badge badge-status-${c.status}`}>{c.status}</span>
                        {!c.isPublished && <span className="badge badge-neutral">draft</span>}
                      </div>
                    </td>
                    <td className="faint">{formatDateTime(c.startAt)}</td>
                    <td className="faint">{formatLength(c.durationMinutes)}</td>
                    <td className="num">{c.problemCount}</td>
                    <td className="num">{c.participantCount}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-sm" onClick={() => startEdit(c.id)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => remove(c.id, c.title)}
                        >
                          Delete
                        </button>
                      </div>
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
