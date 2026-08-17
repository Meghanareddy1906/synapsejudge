import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form);
      navigate(location.state?.from ?? '/problems', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Welcome back.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="field">
          <label htmlFor="identifier">Handle or email</label>
          <input
            id="identifier"
            type="text"
            required
            autoComplete="username"
            placeholder="demo"
            value={form.identifier}
            onChange={(e) => setForm({ ...form, identifier: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="faint" style={{ marginTop: '1rem', textAlign: 'center' }}>
          No account? <Link to="/register">Create one</Link>
        </p>
      </form>
    </div>
  );
}
