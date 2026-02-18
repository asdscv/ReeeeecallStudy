import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { getCurrentUser, logout as logoutUser, getApiKeys, createApiKey, deleteApiKey } from '../lib/storage';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Key, Copy, Trash2, Eye, EyeOff, Plus } from 'lucide-react';
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
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpireDays, setNewKeyExpireDays] = useState(30);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    getUserName();
    loadSettings();
    fetchApiKeys();
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

  function fetchApiKeys() {
    const keys = getApiKeys();
    setApiKeys(keys);
  }

  function handleCreateApiKey() {
    if (!newKeyName.trim()) {
      toast.error('키 이름을 입력해주세요.');
      return;
    }
    
    if (newKeyExpireDays < 1 || newKeyExpireDays > 90) {
      toast.error('만료일은 1일에서 90일 사이여야 합니다.');
      return;
    }
    
    const newKey = createApiKey(newKeyName, newKeyExpireDays);
    if (newKey) {
      fetchApiKeys();
      toast.success('API 키가 생성되었습니다!');
      setShowCreateModal(false);
      setNewKeyName('');
      setNewKeyExpireDays(30);
    } else {
      toast.error('API 키 생성에 실패했습니다.');
    }
  }

  function handleDeleteApiKey(key: string) {
    deleteApiKey(key);
    setApiKeys(apiKeys.filter(k => k !== key));
    toast.success('API 키가 삭제되었습니다!');
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

      {/* API Key Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">API 키 관리</h2>
            <p className="text-sm text-gray-500 mt-1">
              최대 1개의 API 키를 생성할 수 있습니다
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={apiKeys.length >= 1}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            <Plus className="w-4 h-4" />
            새 키 생성
          </button>
        </div>

        {apiKeys.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            아직 생성된 API 키가 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((apiKey: any) => {
              const isExpired = new Date(apiKey.expiresAt) < new Date();
              const isVisible = visibleKeys.has(apiKey.id);
              const daysUntilExpiry = Math.ceil((new Date(apiKey.expiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
              
              return (
                <div key={apiKey.id} className={`border rounded-lg p-4 ${isExpired ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Key className="w-4 h-4 text-gray-500" />
                        <span className="font-medium text-gray-900">{apiKey.name}</span>
                        {isExpired && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">만료됨</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <code className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs font-mono">
                          {isVisible ? apiKey.key : `${apiKey.key.substring(0, 8)}${'•'.repeat(32)}`}
                        </code>
                        <button
                          onClick={() => {
                            const newVisible = new Set(visibleKeys);
                            if (isVisible) {
                              newVisible.delete(apiKey.id);
                            } else {
                              newVisible.add(apiKey.id);
                            }
                            setVisibleKeys(newVisible);
                          }}
                          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                          title={isVisible ? '숨기기' : '보기'}
                        >
                          {isVisible ? <EyeOff className="w-4 h-4 text-gray-600" /> : <Eye className="w-4 h-4 text-gray-600" />}
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(apiKey.key);
                            toast.success('API 키가 복사되었습니다!');
                          }}
                          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                          title="복사"
                        >
                          <Copy className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('정말로 이 API 키를 삭제하시겠습니까?')) {
                              deleteApiKey(apiKey.id);
                              fetchApiKeys();
                              toast.success('API 키가 삭제되었습니다.');
                            }
                          }}
                          className="p-1.5 hover:bg-red-100 rounded transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 space-y-1 mt-3">
                    <div>생성일: {new Date(apiKey.createdAt).toLocaleString('ko-KR')}</div>
                    <div className={isExpired ? 'text-red-600 font-medium' : ''}>
                      만료일: {new Date(apiKey.expiresAt).toLocaleString('ko-KR')} 
                      {!isExpired && ` (${daysUntilExpiry}일 남음)`}
                    </div>
                    {apiKey.lastUsedAt && (
                      <div>마지막 사용: {new Date(apiKey.lastUsedAt).toLocaleString('ko-KR')}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        
        {apiKeys.length >= 1 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-800">
              ℹ️ 새 API 키를 생성하려면 기존 키를 먼저 삭제해주세요.
            </p>
          </div>
        )}
      </div>

      {/* Save Button */}
      <button
        onClick={saveSettings}
        className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
      >
        설정 저장
      </button>

      {/* Create API Key Modal */}
      {showCreateModal && (
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>API 키 생성</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-2 block">
                  키 이름
                </Label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="예: 개발용 API 키"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-2 block">
                  만료일 (최대 90일)
                </Label>
                <input
                  type="number"
                  value={newKeyExpireDays}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1;
                    if (value >= 1 && value <= 90) {
                      setNewKeyExpireDays(value);
                    }
                  }}
                  min={1}
                  max={90}
                  placeholder="30"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  1일부터 90일까지 설정 가능합니다.
                </p>
              </div>
              
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-800">
                  💡 생성된 API 키는 한 번만 표시됩니다. 안전한 곳에 보관하세요.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleCreateApiKey}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                생성
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}