import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Problems from './pages/Problems.jsx';
import ProblemDetail from './pages/ProblemDetail.jsx';
import Submissions from './pages/Submissions.jsx';
import SubmissionDetail from './pages/SubmissionDetail.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Arenas from './pages/Arenas.jsx';
import ArenaDetail from './pages/ArenaDetail.jsx';
import AdminProblems from './pages/admin/AdminProblems.jsx';
import AdminContests from './pages/admin/AdminContests.jsx';
import AdminPlagiarism from './pages/admin/AdminPlagiarism.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/problems/:slug" element={<ProblemDetail />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/arenas" element={<Arenas />} />
        <Route path="/arenas/:slug" element={<ArenaDetail />} />

        <Route
          path="/submissions"
          element={
            <ProtectedRoute>
              <Submissions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/submissions/:id"
          element={
            <ProtectedRoute>
              <SubmissionDetail />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/problems"
          element={
            <ProtectedRoute adminOnly>
              <AdminProblems />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/contests"
          element={
            <ProtectedRoute adminOnly>
              <AdminContests />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/plagiarism"
          element={
            <ProtectedRoute adminOnly>
              <AdminPlagiarism />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute adminOnly>
              <AdminUsers />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
