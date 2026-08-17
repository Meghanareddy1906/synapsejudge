import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const USER_LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/problems', label: 'Problems' },
  { to: '/arenas', label: 'Arenas' },
  { to: '/leaderboard', label: 'Leaderboard' },
];

const ADMIN_LINKS = [
  { to: '/admin/problems', label: 'Problems' },
  { to: '/admin/contests', label: 'Arenas' },
  { to: '/admin/plagiarism', label: 'Plagiarism review' },
  { to: '/admin/users', label: 'Users' },
];

/** The admin portal lives behind one menu so the main nav stays a solver's nav. */
function AdminMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => event.key === 'Escape' && setOpen(false);

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const inAdmin = location.pathname.startsWith('/admin');

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`nav-link menu-trigger ${inAdmin ? 'active' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        Admin <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {ADMIN_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className="menu-item" role="menuitem">
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app">
      <nav className="nav">
        <Link to="/" className="nav-brand">
          <span className="brand-mark" aria-hidden="true" />
          Synapse<span className="brand-accent">Judge</span>
        </Link>

        <div className="nav-links">
          {USER_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className="nav-link">
              {link.label}
            </NavLink>
          ))}
          {user && (
            <NavLink to="/submissions" className="nav-link">
              My Submissions
            </NavLink>
          )}
          {isAdmin && <AdminMenu />}
        </div>

        <div className="nav-right">
          {user ? (
            <>
              <span className="faint">
                {user.handle}
                {isAdmin && <span className="badge badge-purple" style={{ marginLeft: 8 }}>admin</span>}
              </span>
              <button type="button" className="btn btn-sm" onClick={handleLogout}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-sm">
                Sign in
              </Link>
              <Link to="/register" className="btn btn-sm btn-primary">
                Create account
              </Link>
            </>
          )}
        </div>
      </nav>

      <main className="main">{children}</main>

      <footer className="footer">
        <strong>SynapseJudge</strong> — submissions execute in ephemeral Docker containers with no
        network access, a read-only root filesystem and hard memory, CPU and process ceilings.
      </footer>
    </div>
  );
}
