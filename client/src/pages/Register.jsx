import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ handle: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      navigate('/problems', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Create account</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Pick a handle — it is what appears on the leaderboard.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="field">
          <label htmlFor="handle">Handle</label>
          <input
            id="handle"
            required
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_]+"
            title="Letters, numbers and underscores only."
            value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <span className="faint">At least 8 characters.</span>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <p className="faint" style={{ marginTop: '1rem', textAlign: 'center' }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
