import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { getCurrentUser } from '../lib/storage';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  function checkAuth() {
    try {
      const user = getCurrentUser();
      setAuthenticated(!!user);
    } catch (error) {
      console.error('Auth check error:', error);
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  return <>{children}</>;
}