import { useEffect, useState } from 'react';
import { get, post, put, del } from '../../api/client.js';

const BLANK = {
  title: '',
  slug: '',
  statement: '',
  inputFormat: '',
  outputFormat: '',
  constraints: '',
  difficulty: 'easy',
  topics: '',
  timeLimitMs: 2000,
  memoryLimitMb: 256,
  isPublished: false,
  testCases: [{ input: '', expectedOutput: '', isSample: true }],
};

function toForm(problem) {
  return {
    ...problem,
    topics: (problem.topics ?? []).join(', '),
    testCases: problem.testCases?.length ? problem.testCases : BLANK.testCases,
  };
}

function toPayload(form) {
  return {
    title: form.title,
    slug: form.slug || undefined,
    statement: form.statement,
    inputFormat: form.inputFormat,
    outputFormat: form.outputFormat,
    constraints: form.constraints,
    difficulty: form.difficulty,
    topics: form.topics
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    timeLimitMs: Number(form.timeLimitMs),
    memoryLimitMb: Number(form.memoryLimitMb),
    isPublished: form.isPublished,
    testCases: form.testCases.map((tc) => ({
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      isSample: Boolean(tc.isSample),
    })),
  };
}

export default function AdminProblems() {
  const [problems, setProblems] = useState([]);
  const [form, setForm] = useState(null); // null = list view
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    get('/admin/problems')
      .then((res) => setProblems(res.problems))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm({ ...BLANK, testCases: [{ input: '', expectedOutput: '', isSample: true }] });
    setError('');
    setNotice('');
  };

  const startEdit = async (id) => {
    setError('');
    setNotice('');
    try {
      const { problem } = await get(`/admin/problems/${id}`);
      setEditingId(id);
      setForm(toForm(problem));
    } catch (err) {
      setError(err.message);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = toPayload(form);
      if (editingId) {
        await put(`/admin/problems/${editingId}`, payload);
        setNotice('Problem updated.');
      } else {
        await post('/admin/problems', payload);
        setNotice('Problem created.');
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
    // Deleting a problem also discards its submission history — make that explicit.
    if (!window.confirm(`Delete "${title}" and every submission against it? This cannot be undone.`))
      return;
    try {
      await del(`/admin/problems/${id}`);
      setNotice('Problem deleted.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const rejudge = async (id, title) => {
    if (!window.confirm(`Re-queue every submission for "${title}"?`)) return;
    try {
      const res = await post(`/admin/problems/${id}/rejudge`);
      setNotice(`Re-queued ${res.requeued} submission(s).`);
    } catch (err) {
      setError(err.message);
    }
  };

  const updateTestCase = (index, patch) => {
    const next = form.testCases.map((tc, i) => (i === index ? { ...tc, ...patch } : tc));
    setForm({ ...form, testCases: next });
  };

  /* --------------------------------- form --------------------------------- */

  if (form) {
    return (
      <form className="card" onSubmit={save}>
        <div className="card-header">
          <h1>{editingId ? 'Edit problem' : 'New problem'}</h1>
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
              value={form.slug ?? ''}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="difficulty">Difficulty</label>
            <select
              id="difficulty"
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="statement">Statement</label>
          <textarea
            id="statement"
            required
            rows={8}
            value={form.statement}
            onChange={(e) => setForm({ ...form, statement: e.target.value })}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="inputFormat">Input format</label>
            <textarea
              id="inputFormat"
              rows={3}
              value={form.inputFormat ?? ''}
              onChange={(e) => setForm({ ...form, inputFormat: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="outputFormat">Output format</label>
            <textarea
              id="outputFormat"
              rows={3}
              value={form.outputFormat ?? ''}
              onChange={(e) => setForm({ ...form, outputFormat: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="constraints">Constraints</label>
          <textarea
            id="constraints"
            rows={3}
            value={form.constraints ?? ''}
            onChange={(e) => setForm({ ...form, constraints: e.target.value })}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="topics">Topics (comma separated)</label>
            <input
              id="topics"
              value={form.topics}
              onChange={(e) => setForm({ ...form, topics: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="time">Time limit (ms)</label>
            <input
              id="time"
              type="number"
              min={200}
              max={15000}
              value={form.timeLimitMs}
              onChange={(e) => setForm({ ...form, timeLimitMs: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="memory">Memory limit (MB)</label>
            <input
              id="memory"
              type="number"
              min={32}
              max={1024}
              value={form.memoryLimitMb}
              onChange={(e) => setForm({ ...form, memoryLimitMb: e.target.value })}
            />
          </div>
        </div>

        <div className="card-header" style={{ marginTop: '1rem' }}>
          <h2>Test cases</h2>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              setForm({
                ...form,
                testCases: [...form.testCases, { input: '', expectedOutput: '', isSample: false }],
              })
            }
          >
            Add test case
          </button>
        </div>

        <p className="faint">
          Sample cases are shown on the problem page. Everything else stays hidden from solvers.
        </p>

        {form.testCases.map((tc, index) => (
          <div className="card" key={index} style={{ background: 'var(--bg)' }}>
            <div className="spread" style={{ marginBottom: '0.6rem' }}>
              <strong>Test {index + 1}</strong>
              <div className="row">
                <label style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(tc.isSample)}
                    onChange={(e) => updateTestCase(index, { isSample: e.target.checked })}
                    style={{ width: 'auto', marginRight: 6 }}
                  />
                  Sample
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={form.testCases.length === 1}
                  onClick={() =>
                    setForm({ ...form, testCases: form.testCases.filter((_, i) => i !== index) })
                  }
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="sample-grid">
              <div>
                <label>Input</label>
                <textarea
                  className="code"
                  rows={4}
                  value={tc.input}
                  onChange={(e) => updateTestCase(index, { input: e.target.value })}
                />
              </div>
              <div>
                <label>Expected output</label>
                <textarea
                  className="code"
                  rows={4}
                  value={tc.expectedOutput}
                  onChange={(e) => updateTestCase(index, { expectedOutput: e.target.value })}
                />
              </div>
            </div>
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
            Published (visible to solvers)
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save problem'}
          </button>
        </div>
      </form>
    );
  }

  /* --------------------------------- list --------------------------------- */

  return (
    <>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <h1>Manage problems</h1>
        <button type="button" className="btn btn-primary" onClick={startCreate}>
          New problem
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="card">
        {problems.length === 0 ? (
          <div className="empty">No problems yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Difficulty</th>
                  <th>Status</th>
                  <th className="num">Submissions</th>
                  <th className="num">Accepted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {problems.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.title}
                      <div className="faint">{p.slug}</div>
                    </td>
                    <td>
                      <span className={`badge badge-${p.difficulty}`}>{p.difficulty}</span>
                    </td>
                    <td>
                      <span className={`badge ${p.isPublished ? 'badge-accent' : 'badge-neutral'}`}>
                        {p.isPublished ? 'published' : 'draft'}
                      </span>
                    </td>
                    <td className="num">{p.stats.submissions}</td>
                    <td className="num">{p.stats.accepted}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-sm" onClick={() => startEdit(p.id)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => rejudge(p.id, p.title)}
                        >
                          Rejudge
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => remove(p.id, p.title)}
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
