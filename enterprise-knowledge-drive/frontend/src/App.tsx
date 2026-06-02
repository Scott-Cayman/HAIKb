import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import BackendReadyCheck from './components/BackendReadyCheck';

// Layouts
import MainLayout from './layouts/MainLayout';
import AdminLayout from './layouts/AdminLayout';

// Pages
import Login from './pages/Login';
import DingTalkCallback from './pages/DingTalkCallback';
import Home from './pages/Home';
import FolderDetail from './pages/FolderDetail';
import FilePreview from './pages/FilePreview';
import Search from './pages/Search';
import Recent from './pages/Recent';
import Favorites from './pages/Favorites';
import Forbidden from './pages/Forbidden';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import FoldersManage from './pages/admin/FoldersManage';
import FilesManage from './pages/admin/FilesManage';
import UsersManage from './pages/admin/UsersManage';
import Settings from './pages/admin/Settings';
import RagManage from './pages/admin/RagManage';

const ProtectedRoute = ({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) => {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (requireAdmin && user && !user.is_admin) {
    return <Navigate to="/403" />;
  }

  return <>{children}</>;
};

const App = () => {
  const checkAuth = useAuthStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <BackendReadyCheck>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/dingtalk/callback" element={<DingTalkCallback />} />
          <Route path="/403" element={<Forbidden />} />
          
          {/* Main User App */}
          <Route path="/" element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Home />} />
            <Route path="folders/:id" element={<FolderDetail />} />
            <Route path="files/:id" element={<FilePreview />} />
            <Route path="search" element={<Search />} />
            <Route path="recent" element={<Recent />} />
            <Route path="favorites" element={<Favorites />} />
          </Route>

          {/* Admin App */}
          <Route path="/admin" element={
            <ProtectedRoute requireAdmin={true}>
              <AdminLayout />
            </ProtectedRoute>
          }>
            <Route index element={<AdminDashboard />} />
            <Route path="folders" element={<FoldersManage />} />
            <Route path="files" element={<FilesManage />} />
            <Route path="users" element={<UsersManage />} />
            <Route path="settings" element={<Settings />} />
            <Route path="rag" element={<RagManage />} />
          </Route>
        </Routes>
      </Router>
    </BackendReadyCheck>
  );
};

export default App;
