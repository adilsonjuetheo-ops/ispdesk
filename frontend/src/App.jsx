import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/superadmin/Dashboard.jsx';
import Tenants from './pages/superadmin/Tenants.jsx';
import TenantDetail from './pages/superadmin/TenantDetail.jsx';
import Inbox from './pages/tenant/Inbox.jsx';
import Agents from './pages/tenant/Agents.jsx';
import Settings from './pages/tenant/Settings.jsx';
import SuperAdminLayout from './components/layout/SuperAdminLayout.jsx';
import TenantLayout from './components/layout/TenantLayout.jsx';

function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'superadmin') return <Navigate to="/admin/dashboard" replace />;
  return <Navigate to="/inbox" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RootRedirect />} />

        <Route path="/admin" element={
          <ProtectedRoute roles={['superadmin']}>
            <SuperAdminLayout />
          </ProtectedRoute>
        }>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:id" element={<TenantDetail />} />
        </Route>

        <Route element={
          <ProtectedRoute roles={['admin', 'agente']}>
            <TenantLayout />
          </ProtectedRoute>
        }>
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/agents" element={
            <ProtectedRoute roles={['admin']}>
              <Agents />
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute roles={['admin']}>
              <Settings />
            </ProtectedRoute>
          } />
        </Route>
      </Routes>
    </HashRouter>
  );
}
