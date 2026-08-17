import { useEffect, useMemo, useState } from 'react';
import { get, patch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDateTime } from '../../utils/time.js';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () =>
    get('/admin/users')
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const changeRole = async (target, role) => {
    const verb = role === 'admin' ? 'Promote' : 'Demote';
    if (!window.confirm(`${verb} ${target.handle} to ${role}?`)) return;

    setBusyId(target.id);
    setError('');
    setNotice('');
    try {
      await patch(`/admin/users/${target.id}/role`, { role });
      setNotice(`${target.handle} is now ${role}.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) => u.handle.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)
    );
  }, [users, search]);

  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Users</h1>
          <p className="muted" style={{ margin: 0 }}>
            {users.length} accounts · {adminCount} admin{adminCount === 1 ? '' : 's'}
          </p>
        </div>
        <input
          placeholder="Search handle or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty">No users match that search.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Handle</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th className="num">Solved</th>
                  <th className="num">Points</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isMe = u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        {u.handle}
                        {isMe && <span className="badge badge-accent" style={{ marginLeft: 8 }}>you</span>}
                      </td>
                      <td className="faint">{u.email}</td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge-purple' : 'badge-neutral'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="num">{u.solvedCount}</td>
                      <td className="num">{u.points}</td>
                      <td className="faint">{formatDateTime(u.createdAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {/* The server also refuses self-demotion — this just avoids
                            offering a button that is guaranteed to fail. */}
                        {isMe ? (
                          <span className="faint">—</span>
                        ) : (
                          <button
                            type="button"
                            className={`btn btn-sm ${u.role === 'admin' ? 'btn-danger' : ''}`}
                            disabled={busyId === u.id}
                            onClick={() => changeRole(u, u.role === 'admin' ? 'user' : 'admin')}
                          >
                            {u.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
