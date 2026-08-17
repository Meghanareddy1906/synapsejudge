import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  // Wait for the boot-time token check; redirecting first would bounce a
  // signed-in user to /login on every refresh.
  if (loading) {
    return (
      <div className="center-page">
        <span className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (adminOnly && !isAdmin) {
    return (
      <div className="card">
        <h2>Not authorised</h2>
        <p className="muted">This area is restricted to administrators.</p>
      </div>
    );
  }

  return children;
}
