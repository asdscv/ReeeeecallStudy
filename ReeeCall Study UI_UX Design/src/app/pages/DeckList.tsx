import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus, MoreVertical, BookOpen } from 'lucide-react';
import { getDecks, createDeck as createDeckStorage, getTemplates } from '../lib/storage';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';

interface Deck {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export function DeckList() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchDecks();
  }, []);

  function fetchDecks() {
    try {
      const data = getDecks();
      setDecks(data);
    } catch (error) {
      console.error('Error fetching decks:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleCreateDeck(deckData: Partial<Deck>) {
    try {
      const newDeck = createDeckStorage(deckData);
      setDecks([...decks, newDeck]);
      setShowCreateModal(false);
      toast.success('덱이 생성되었습니다!');
    } catch (error) {
      console.error('Error creating deck:', error);
      toast.error('덱 생성에 실패했습니다.');
    }
  }

  if (loading) {
    return <div className="text-gray-500">로딩 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">내 덱</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          새 덱 만들기
        </button>
      </div>

      {decks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <BookOpen className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            아직 덱이 없습니다
          </h3>
          <p className="text-gray-500 mb-6">
            새 덱을 만들어 학습을 시작하세요!
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            첫 덱 만들기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateDeckModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateDeck}
        />
      )}
    </div>
  );
}

function DeckCard({ deck }: { deck: Deck }) {
  return (
    <Link
      to={`/decks/${deck.id}`}
      className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow block"
    >
      <div className="flex items-start gap-4">
        <div
          className="w-1 h-full absolute left-0 top-0 bottom-0 rounded-l-xl"
          style={{ backgroundColor: deck.color }}
        />
        <div className="text-3xl">{deck.icon}</div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            {deck.name}
          </h3>
          {deck.description && (
            <p className="text-sm text-gray-500 mb-3">{deck.description}</p>
          )}
          <div className="text-sm text-gray-400">
            생성일: {new Date(deck.createdAt).toLocaleDateString('ko-KR')}
          </div>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-100">
        <button className="w-full py-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
          학습 시작
        </button>
      </div>
    </Link>
  );
}

function CreateDeckModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: Partial<Deck>) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [icon, setIcon] = useState('📚');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('default');
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => {
    const data = getTemplates();
    setTemplates(data);
  }, []);

  const colors = [
    '#3B82F6', // blue
    '#EF4444', // red
    '#22C55E', // green
    '#F59E0B', // amber
    '#8B5CF6', // purple
    '#EC4899', // pink
    '#06B6D4', // cyan
    '#6B7280', // gray
  ];

  const icons = ['📚', '📖', '🇨🇳', '🇺🇸', '🇯🇵', '🧠', '💡', '📝'];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('덱 이름을 입력해주세요.');
      return;
    }
    
    // Get selected template's fields
    const template = templates.find(t => t.id === selectedTemplateId);
    const deckData: any = { 
      name, 
      description, 
      color, 
      icon,
      templateId: selectedTemplateId,
    };
    
    // Copy template structure to deck
    if (template) {
      deckData.fields = template.fields;
      deckData.frontLayout = template.frontLayout;
      deckData.backLayout = template.backLayout;
    }
    
    onCreate(deckData);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 덱 만들기</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              덱 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 영어 단어"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              설명 (선택)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="덱에 대한 간단한 설명"
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              색상 선택
            </label>
            <div className="flex gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              아이콘 선택
            </label>
            <div className="flex gap-2">
              {icons.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`w-12 h-12 text-2xl rounded-lg border-2 transition-all ${
                    icon === i
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              템플릿 선택
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.fields.length}개 필드)
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              선택한 템플릿의 필드 구조를 사용합니다
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              저장
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}