import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { User } from 'lucide-react';
import { getCurrentUser, setCurrentUser } from '../lib/storage';
import { toast } from 'sonner';

export function Login() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Check for existing user on mount
  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      navigate('/');
    }
  }, [navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('이름을 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      setCurrentUser(name.trim());
      toast.success('로그인되었습니다!');
      navigate('/');
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error('로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-gray-200 p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            ReeeCall Study
          </h1>
          <p className="text-gray-500">이름을 입력하여 시작하세요</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>로그인 중...</>
            ) : (
              <>
                <User className="w-4 h-4" />
                시작하기
              </>
            )}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          모든 데이터는 브라우저에 로컬로 저장됩니다.
        </p>
      </div>
    </div>
  );
}