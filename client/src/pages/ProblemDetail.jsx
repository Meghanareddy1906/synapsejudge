import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import CodeEditor, { starterFor } from '../components/CodeEditor.jsx';
import VerdictBadge from '../components/VerdictBadge.jsx';
import Countdown from '../components/Countdown.jsx';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

export default function ProblemDetail() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const arenaSlug = searchParams.get('arena');
  const { user } = useAuth();

  const [arena, setArena] = useState(null);
  const [problem, setProblem] = useState(null);
  const [languages, setLanguages] = useState([]);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [recent, setRecent] = useState([]);

  const [active, setActive] = useState(null); // the submission currently being judged
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  // Drafts survive a refresh — losing an in-progress solution to a stray reload
  // is the single most annoying thing an online judge can do to you.
  const draftKey = `synapsejudge.draft.${slug}.${language}`;

  useEffect(() => {
    get('/submissions/languages')
      .then((res) => setLanguages(res.languages))
      .catch(() => setLanguages([{ id: 'python', label: 'Python 3.11' }]));
  }, []);

  useEffect(() => {
    setError('');
    get(`/problems/${slug}`)
      .then((res) => setProblem(res.problem))
      .catch((err) => setError(err.message));
  }, [slug]);

  // `?arena=` puts the editor in contest mode. A failed lookup silently falls
  // back to practice rather than blocking the page — the banner just won't show.
  useEffect(() => {
    if (!arenaSlug) {
      setArena(null);
      return;
    }
    get(`/contests/${arenaSlug}`)
      .then((res) => setArena(res.contest))
      .catch(() => setArena(null));
  }, [arenaSlug]);

  const arenaLive = arena?.status === 'live';

  useEffect(() => {
    const draft = localStorage.getItem(draftKey);
    setCode(draft ?? starterFor(language));
  }, [draftKey, language]);

  useEffect(() => {
    if (code) localStorage.setItem(draftKey, code);
  }, [code, draftKey]);

  const loadRecent = useCallback(() => {
    if (!user) return;
    get(`/problems/${slug}/submissions`)
      .then((res) => setRecent(res.submissions))
      .catch(() => {});
  }, [slug, user]);

  useEffect(loadRecent, [loadRecent]);

  // Clear any in-flight poll when leaving the page.
  useEffect(() => () => clearTimeout(pollRef.current), []);

  const pollVerdict = useCallback(
    (submissionId, startedAt = Date.now()) => {
      pollRef.current = setTimeout(async () => {
        try {
          const { submission } = await get(`/submissions/${submissionId}`);
          setActive(submission);

          if (submission.verdict === 'pending' || submission.verdict === 'running') {
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
              setError('Still judging — check the submission page in a moment.');
              return;
            }
            pollVerdict(submissionId, startedAt);
          } else {
            loadRecent();
          }
        } catch (err) {
          setError(err.message);
        }
      }, POLL_INTERVAL_MS);
    },
    [loadRecent]
  );

  const submit = async () => {
    if (!problem) return;
    setError('');
    setSubmitting(true);
    try {
      const { submission } = await post('/submissions', {
        problemId: problem.id,
        language,
        code,
        // Only attributed to the arena while it is actually running; a late
        // submission falls back to practice instead of erroring out.
        ...(arenaLive ? { contestId: arena.id } : {}),
      });
      setActive(submission);
      pollVerdict(submission.id);
      loadRecent();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !problem) return <div className="alert alert-error">{error}</div>;
  if (!problem) {
    return (
      <div className="center-page">
        <span className="spinner" />
      </div>
    );
  }

  return (
    <>
      {arena && (
        <div className={`arena-strip arena-${arena.status}`}>
          <div className="row">
            <span className={`badge badge-status-${arena.status}`}>
              {arena.status === 'live' ? '● Live' : arena.status === 'upcoming' ? 'Upcoming' : 'Finished'}
            </span>
            <Link to={`/arenas/${arena.slug}`}>{arena.title}</Link>
            <span className="faint">
              {arenaLive
                ? 'Submissions from this page count toward the standings.'
                : 'This arena is not running — submissions count as practice only.'}
            </span>
          </div>
          {arenaLive && <Countdown target={arena.endAt} label="Ends in" />}
        </div>
      )}

      <div className="split">
      {/* ------------------------------ statement ------------------------------ */}
      <div>
        <div className="card">
          <div className="card-header">
            <div>
              <h1 style={{ marginBottom: 4 }}>{problem.title}</h1>
              <div className="row">
                <span className={`badge badge-${problem.difficulty}`}>{problem.difficulty}</span>
                <span className="badge badge-neutral">{problem.points} pts</span>
                {problem.userStatus === 'solved' && (
                  <span className="badge badge-accent">solved</span>
                )}
              </div>
            </div>
          </div>

          <p className="faint">
            Time limit {problem.timeLimitMs} ms · Memory limit {problem.memoryLimitMb} MB ·{' '}
            {problem.totalTests} tests
          </p>

          <div className="statement">{problem.statement}</div>

          {problem.inputFormat && (
            <div className="statement-section">
              <h3>Input</h3>
              <div className="statement">{problem.inputFormat}</div>
            </div>
          )}

          {problem.outputFormat && (
            <div className="statement-section">
              <h3>Output</h3>
              <div className="statement">{problem.outputFormat}</div>
            </div>
          )}

          {problem.constraints && (
            <div className="statement-section">
              <h3>Constraints</h3>
              <div className="statement">{problem.constraints}</div>
            </div>
          )}

          {problem.samples.map((sample, index) => (
            <div className="statement-section" key={index}>
              <h3>Sample {index + 1}</h3>
              <div className="sample-grid">
                <div>
                  <div className="faint">Input</div>
                  <pre>{sample.input}</pre>
                </div>
                <div>
                  <div className="faint">Output</div>
                  <pre>{sample.expectedOutput}</pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* -------------------------------- editor ------------------------------- */}
      <div>
        <div className="card">
          <div className="card-header">
            <h2>Your solution</h2>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {!user ? (
            <div className="alert alert-info">
              <Link to="/login">Sign in</Link> to submit a solution.
            </div>
          ) : null}

          <CodeEditor
            value={code}
            onChange={setCode}
            language={language}
            languages={languages}
            onLanguageChange={setLanguage}
            disabled={!user || submitting}
          />

          <div className="row" style={{ marginTop: '0.9rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={!user || submitting || !code.trim()}
            >
              {submitting ? 'Submitting…' : arenaLive ? 'Submit to arena' : 'Submit'}
            </button>
            <span className="faint">
              Runs against all {problem.totalTests} tests
              {arenaLive ? ` · scored in ${arena.title}` : ''}.
            </span>
          </div>
        </div>

        {active && (
          <div className="card">
            <div className="card-header">
              <h2>Result</h2>
              <Link to={`/submissions/${active.id}`} className="faint">
                Open details →
              </Link>
            </div>

            <div className="spread">
              <VerdictBadge verdict={active.verdict} />
              <span className="num faint">
                {active.passedTests}/{active.totalTests} tests
                {active.maxTimeMs ? ` · ${active.maxTimeMs} ms` : ''}
              </span>
            </div>

            {active.totalTests > 0 && (
              <div className="progress" style={{ marginTop: '0.6rem' }}>
                <div style={{ width: `${(active.passedTests / active.totalTests) * 100}%` }} />
              </div>
            )}

            {active.failure?.compileOutput && (
              <div className="statement-section">
                <h3>Compiler output</h3>
                <pre>{active.failure.compileOutput}</pre>
              </div>
            )}

            {active.failure?.input !== undefined && (
              <div className="statement-section">
                <h3>Failing sample</h3>
                <div className="sample-grid">
                  <div>
                    <div className="faint">Expected</div>
                    <pre>{active.failure.expectedOutput}</pre>
                  </div>
                  <div>
                    <div className="faint">Your output</div>
                    <pre>{active.failure.actualOutput || '(no output)'}</pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {user && recent.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2>Your attempts</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {recent.slice(0, 8).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link to={`/submissions/${s.id}`}>
                          <VerdictBadge verdict={s.verdict} />
                        </Link>
                      </td>
                      <td className="muted">{s.language}</td>
                      <td className="num muted">
                        {s.passedTests}/{s.totalTests}
                      </td>
                      <td className="faint" style={{ textAlign: 'right' }}>
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
