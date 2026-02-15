import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { getCurrentUser, logout as logoutUser } from '../lib/storage';
import { Label } from '../components/ui/label';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';

type SwipeAction = 'again' | 'hard' | 'good' | 'easy' | '';

interface SwipeSettings {
  enabled: boolean;
  left: SwipeAction;
  right: SwipeAction;
  up: SwipeAction;
  down: SwipeAction;
}

export function Settings() {
  const navigate = useNavigate();
  const [dailyNewCards, setDailyNewCards] = useState(20);
  const [userName, setUserName] = useState('');
  const [swipeSettings, setSwipeSettings] = useState<SwipeSettings>({
    enabled: false,
    left: '',
    right: '',
    up: '',
    down: '',
  });

  useEffect(() => {
    getUserName();
    loadSettings();
  }, []);

  function getUserName() {
    const user = getCurrentUser();
    if (user?.name) {
      setUserName(user.name);
    }
  }

  function loadSettings() {
    // Load from localStorage
    const saved = localStorage.getItem('reeecall-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      setDailyNewCards(settings.dailyNewCards || 20);
      setSwipeSettings(settings.swipe || {
        enabled: false,
        left: '',
        right: '',
        up: '',
        down: '',
      });
    }
  }

  function saveSettings() {
    // Validate dailyNewCards
    if (dailyNewCards < 1 || dailyNewCards > 1000) {
      toast.error('일일 신규 카드 한도는 1~1,000장 사이여야 합니다.');
      return;
    }

    const settings = {
      dailyNewCards,
      swipe: swipeSettings,
    };
    localStorage.setItem('reeecall-settings', JSON.stringify(settings));
    toast.success('설정이 저장되었습니다!');
  }

  function handleLogout() {
    logoutUser();
    navigate('/auth/login');
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">설정</h1>

      {/* Study Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <h2 className="text-lg font-semibold text-gray-900">학습 설정</h2>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium text-gray-700 mb-3 block">
              일일 신규 카드 한도
            </Label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={dailyNewCards}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 0;
                  if (value >= 1 && value <= 1000) {
                    setDailyNewCards(value);
                  }
                }}
                min={1}
                max={1000}
                className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <span className="text-sm text-gray-600">장 (최소 1장, 최대 1,000장)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Swipe Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">스와이프 기능</h2>
            <p className="text-sm text-gray-500 mt-1">카드를 스와이프하여 답변을 선택할 수 있습니다</p>
          </div>
          <button
            onClick={() => setSwipeSettings({ ...swipeSettings, enabled: !swipeSettings.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              swipeSettings.enabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                swipeSettings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {swipeSettings.enabled && (
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-600 mb-4">
              각 방향에 동작을 할당하세요. 설정하지 않은 방향은 비활성화됩니다.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Swipe */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
                  <ArrowLeft className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <Label className="text-sm font-medium text-gray-700 mb-1 block">
                    왼쪽 스와이프
                  </Label>
                  <select
                    value={swipeSettings.left}
                    onChange={(e) => setSwipeSettings({ ...swipeSettings, left: e.target.value as SwipeAction })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                  >
                    <option value="">설정 안함</option>
                    <option value="again">Again (다시)</option>
                    <option value="hard">Hard (어려움)</option>
                    <option value="good">Good (적당)</option>
                    <option value="easy">Easy (쉬움)</option>
                  </select>
                </div>
              </div>

              {/* Right Swipe */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
                  <ArrowRight className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <Label className="text-sm font-medium text-gray-700 mb-1 block">
                    오른쪽 스와이프
                  </Label>
                  <select
                    value={swipeSettings.right}
                    onChange={(e) => setSwipeSettings({ ...swipeSettings, right: e.target.value as SwipeAction })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                  >
                    <option value="">설정 안함</option>
                    <option value="again">Again (다시)</option>
                    <option value="hard">Hard (어려움)</option>
                    <option value="good">Good (적당)</option>
                    <option value="easy">Easy (쉬움)</option>
                  </select>
                </div>
              </div>

              {/* Up Swipe */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
                  <ArrowUp className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <Label className="text-sm font-medium text-gray-700 mb-1 block">
                    위쪽 스와이프
                  </Label>
                  <select
                    value={swipeSettings.up}
                    onChange={(e) => setSwipeSettings({ ...swipeSettings, up: e.target.value as SwipeAction })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                  >
                    <option value="">설정 안함</option>
                    <option value="again">Again (다시)</option>
                    <option value="hard">Hard (어려움)</option>
                    <option value="good">Good (적당)</option>
                    <option value="easy">Easy (쉬움)</option>
                  </select>
                </div>
              </div>

              {/* Down Swipe */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600">
                  <ArrowDown className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <Label className="text-sm font-medium text-gray-700 mb-1 block">
                    아래쪽 스와이프
                  </Label>
                  <select
                    value={swipeSettings.down}
                    onChange={(e) => setSwipeSettings({ ...swipeSettings, down: e.target.value as SwipeAction })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                  >
                    <option value="">설정 안함</option>
                    <option value="again">Again (다시)</option>
                    <option value="hard">Hard (어려움)</option>
                    <option value="good">Good (적당)</option>
                    <option value="easy">Easy (쉬움)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-xs text-blue-800">
                💡 <strong>추천 설정:</strong> 왼쪽=Again, 오른쪽=Good (빠른 학습에 유용)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Account Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <h2 className="text-lg font-semibold text-gray-900">계정</h2>

        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">
            사용자 이름
          </Label>
          <div className="text-gray-900">{userName}</div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
        >
          로그아웃
        </button>
      </div>

      {/* Save Button */}
      <button
        onClick={saveSettings}
        className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
      >
        설정 저장
      </button>
    </div>
  );
}