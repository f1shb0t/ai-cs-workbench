import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Amplify } from 'aws-amplify';
import MainLayout from './components/Layout/MainLayout';
import Workbench from './pages/Workbench';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Login from './pages/Login';
import { getUser } from './services/auth';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || '',
    },
  },
});

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    getUser().then((user) => setAuthed(!!user)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <Spin size="large" style={{ display: 'block', margin: '200px auto' }} />;
  if (!authed) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const App: React.FC = () => (
  <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#1677ff' } }}>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/workbench" element={<Workbench />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<Navigate to="/workbench" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </ConfigProvider>
);

export default App;
