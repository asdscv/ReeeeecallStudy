import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { Plus, Play, FileDown, FileUp, Search, Settings2, Edit2, Trash2, X, Filter, Tag } from 'lucide-react';
import { getDeck, getCards, createCard as createCardStorage, deleteDeck, updateDeck, getTemplates, getTemplate, deleteCard, updateCard } from '../lib/storage';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { StudyModeModal } from '../components/StudyModeModal';
import { DeckStats } from '../components/DeckStats';
import { toast } from 'sonner';

interface Field {
  id: string;
  name: string;
  type: 'text' | 'image' | 'audio';
  ttsEnabled?: boolean;
  ttsLang?: string;
  ttsVoice?: string;
}

interface LayoutItem {
  fieldId: string;
}

interface Deck {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  fields: Field[];
  frontLayout: LayoutItem[];
  backLayout: LayoutItem[];
}

interface Card {
  id: string;
  deckId: string;
  fields: Record<string, string>;
  tags: string[];
  status: 'new' | 'learning' | 'review' | 'suspended';
  nextReview: string | null;
  createdAt: string;
}

export function DeckDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCard, setShowAddCard] = useState(false);
  const [showStudyModal, setShowStudyModal] = useState(false);
  const [showCSVUpload, setShowCSVUpload] = useState(false);
  const [showJSONUpload, setShowJSONUpload] = useState(false);
  const [showEditDeck, setShowEditDeck] = useState(false);
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [cardsPerPage, setCardsPerPage] = useState(20);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  
  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Card['status'] | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [allTags, setAllTags] = useState<string[]>([]);

  useEffect(() => {
    fetchDeck();
    fetchCards();
    loadVoices();
  }, [id]);

  useEffect(() => {
    // Extract all unique tags from cards
    const tags = new Set<string>();
    cards.forEach(card => {
      if (card.tags) {
        card.tags.forEach(tag => tags.add(tag));
      }
    });
    setAllTags(Array.from(tags).sort());
  }, [cards]);

  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    setAvailableVoices(voices);
    
    // Safari 대응: voices가 비동기로 로드될 수 있음
    if (voices.length === 0) {
      speechSynthesis.onvoiceschanged = () => {
        setAvailableVoices(speechSynthesis.getVoices());
      };
    }
  }

  function fetchDeck() {
    try {
      const data = getDeck(id!);
      setDeck(data);
    } catch (error) {
      console.error('Error fetching deck:', error);
    } finally {
      setLoading(false);
    }
  }

  function fetchCards() {
    try {
      const data = getCards(id!);
      setCards(data);
    } catch (error) {
      console.error('Error fetching cards:', error);
    }
  }

  function handleCreateCard(cardData: Partial<Card>) {
    try {
      const newCard = createCardStorage(id!, cardData);
      setCards([...cards, newCard]);
      setShowAddCard(false);
      toast.success('카드가 추가되었습니다!');
    } catch (error) {
      console.error('Error creating card:', error);
      toast.error('카드 추가에 실패했습니다.');
    }
  }

  function getStatusBadge(status: Card['status']) {
    const variants: Record<Card['status'], { label: string; className: string }> = {
      new: { label: '새 카드', className: 'bg-blue-100 text-blue-700' },
      learning: { label: '학습중', className: 'bg-amber-100 text-amber-700' },
      review: { label: '복습', className: 'bg-green-100 text-green-700' },
      suspended: { label: '보류', className: 'bg-gray-100 text-gray-700' },
    };
    const variant = variants[status];
    return (
      <Badge className={variant.className}>
        {variant.label}
      </Badge>
    );
  }

  if (loading) {
    return <div className="text-gray-500">로딩 중...</div>;
  }

  if (!deck) {
    return <div className="text-gray-500">덱을 찾을 수 없습니다.</div>;
  }

  const newCards = cards.filter((c) => c.status === 'new').length;
  const dueCards = cards.filter((c) => {
    if (!c.nextReview) return true;
    return new Date(c.nextReview) <= new Date();
  }).length;

  // Apply search and filters
  const filteredCards = cards.filter(card => {
    // Search filter - search in all field values
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = Object.values(card.fields).some(value =>
        value.toLowerCase().includes(query)
      );
      if (!matchesSearch) return false;
    }

    // Status filter
    if (statusFilter !== 'all' && card.status !== statusFilter) {
      return false;
    }

    // Tag filter
    if (tagFilter && (!card.tags || !card.tags.includes(tagFilter))) {
      return false;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="text-4xl">{deck.icon}</div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{deck.name}</h1>
            {deck.description && (
              <p className="text-gray-500 mb-3">{deck.description}</p>
            )}
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>전체 {cards.length}장</span>
              <span>·</span>
              <span>새 카드 {newCards}</span>
              <span>·</span>
              <span>복습 예정 {dueCards}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowStudyModal(true)}
            disabled={cards.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" />
            학습 시작
          </button>
          <button
            onClick={() => setShowAddCard(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            카드 추가
          </button>
          <button
            onClick={() => setShowCSVUpload(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FileUp className="w-4 h-4" />
            CSV 업로드
          </button>
          <button
            onClick={() => setShowJSONUpload(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FileUp className="w-4 h-4" />
            JSON 업로드
          </button>
          <button
            onClick={() => setShowEditDeck(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            덱 수정
          </button>
          <button
            onClick={() => {
              if (confirm('정말로  덱을 삭제하시겠습니까? 모든 카드도 함께 삭제됩니다.')) {
                deleteDeck(id!);
                toast.success('덱이 삭제되었습니다.');
                navigate('/decks');
              }
            }}
            className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            덱 삭제
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="cards" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cards">카드 목록</TabsTrigger>
          <TabsTrigger value="stats">통계</TabsTrigger>
        </TabsList>

        <TabsContent value="cards" className="space-y-4">
          {cards.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <p className="text-gray-500 mb-4">아직 카드가 없습니다.</p>
              <button
                onClick={() => setShowAddCard(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                첫 카드 추가하기
              </button>
            </div>
          ) : (
            <>
              {/* Search and Filter Bar */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex flex-col md:flex-row gap-3">
                  {/* Search Input */}
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="카드 내용 검색..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Status Filter */}
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-gray-500" />
                    <select
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value as Card['status'] | 'all');
                        setCurrentPage(1);
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                    >
                      <option value="all">모든 상태</option>
                      <option value="new">새 카드</option>
                      <option value="learning">학습중</option>
                      <option value="review">복습</option>
                      <option value="suspended">보류</option>
                    </select>
                  </div>

                  {/* Tag Filter */}
                  {allTags.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-gray-500" />
                      <select
                        value={tagFilter}
                        onChange={(e) => {
                          setTagFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                      >
                        <option value="">모든 태그</option>
                        {allTags.map(tag => (
                          <option key={tag} value={tag}>{tag}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Clear Filters Button */}
                  {(searchQuery || statusFilter !== 'all' || tagFilter) && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setStatusFilter('all');
                        setTagFilter('');
                        setCurrentPage(1);
                      }}
                      className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                    >
                      필터 초기화
                    </button>
                  )}
                </div>

                {/* Active Filters Display */}
                {(searchQuery || statusFilter !== 'all' || tagFilter) && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">활성 필터:</span>
                    {searchQuery && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded">
                        검색: "{searchQuery}"
                        <button onClick={() => setSearchQuery('')} className="hover:text-blue-900">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                    {statusFilter !== 'all' && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded">
                        상태: {statusFilter === 'new' ? '새 카드' : statusFilter === 'learning' ? '학습중' : statusFilter === 'review' ? '복습' : '보류'}
                        <button onClick={() => setStatusFilter('all')} className="hover:text-blue-900">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                    {tagFilter && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded">
                        태그: {tagFilter}
                        <button onClick={() => setTagFilter('')} className="hover:text-blue-900">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      ({filteredCards.length}장 결과)
                    </span>
                  </div>
                )}
              </div>

              {filteredCards.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                  <p className="text-gray-500 mb-2">검색 결과가 없습니다.</p>
                  <p className="text-sm text-gray-400">필터를 조정하거나 초기화해보세요.</p>
                </div>
              ) : (
                <>
              {/* Pagination Controls */}
              <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">페이지당 카드 수:</span>
                  <select
                    value={cardsPerPage}
                    onChange={(e) => {
                      setCardsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm"
                  >
                    <option value={10}>10개</option>
                    <option value={20}>20개</option>
                    <option value={30}>30개</option>
                    <option value={50}>50개</option>
                    <option value={100}>100개</option>
                  </select>
                </div>
                <div className="text-sm text-gray-600">
                  전체 {filteredCards.length}장 중 {((currentPage - 1) * cardsPerPage) + 1}-
                  {Math.min(currentPage * cardsPerPage, filteredCards.length)}장 표시
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {deck.fields.map((field) => (
                        <th
                          key={field.id}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap"
                        >
                          {field.name}
                        </th>
                      ))}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap sticky right-40 bg-gray-50">
                        상태
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap sticky right-20 bg-gray-50">
                        다음 복습
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap sticky right-0 bg-gray-50">
                        작업
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredCards
                      .slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage)
                      .map((card) => (
                        <tr key={card.id} className="hover:bg-gray-50">
                          {deck.fields.map((field) => (
                            <td
                              key={field.id}
                              className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate"
                              title={card.fields[field.name] || '-'}
                            >
                              {card.fields[field.name] || '-'}
                            </td>
                          ))}
                          <td className="px-6 py-4 sticky right-40 bg-white">
                            {getStatusBadge(card.status)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap sticky right-20 bg-white">
                            {card.nextReview
                              ? new Date(card.nextReview).toLocaleDateString('ko-KR')
                              : '-'}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap sticky right-0 bg-white">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setEditingCard(card);
                                }}
                                className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                title="수정"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm('정말로 이 카드를 삭제하시겠습니까?')) {
                                    deleteCard(id!, card.id);
                                    setCards(cards.filter(c => c.id !== card.id));
                                    toast.success('카드가 삭제되었습니다.');
                                  }
                                }}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="삭제"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Buttons */}
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  이전
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.ceil(filteredCards.length / cardsPerPage) }, (_, i) => i + 1)
                    .filter(page => {
                      // Show: first, last, current, and 2 pages around current
                      const totalPages = Math.ceil(filteredCards.length / cardsPerPage);
                      return (
                        page === 1 ||
                        page === totalPages ||
                        Math.abs(page - currentPage) <= 2
                      );
                    })
                    .map((page, index, array) => {
                      // Add ellipsis when there's a gap
                      const prevPage = array[index - 1];
                      const showEllipsis = prevPage && page - prevPage > 1;
                      
                      return (
                        <div key={page} className="flex items-center gap-1">
                          {showEllipsis && <span className="px-2 text-gray-400">...</span>}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-1.5 rounded-lg text-sm ${
                              currentPage === page
                                ? 'bg-blue-600 text-white'
                                : 'border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        </div>
                      );
                    })}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredCards.length / cardsPerPage), p + 1))}
                  disabled={currentPage === Math.ceil(filteredCards.length / cardsPerPage)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  다음
                </button>
              </div>
                </>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="stats">
          <DeckStats deckId={id!} />
        </TabsContent>
      </Tabs>

      {showAddCard && !editingCard && (
        <AddCardModal
          deck={deck}
          onClose={() => setShowAddCard(false)}
          onCreate={handleCreateCard}
          editingCard={null}
        />
      )}

      {editingCard && (
        <EditCardModal
          deck={deck}
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSave={(updates) => {
            updateCard(id!, editingCard.id, updates);
            setCards(cards.map(c => c.id === editingCard.id ? { ...c, ...updates } : c));
            setEditingCard(null);
            toast.success('카드가 수정되었습니다!');
          }}
        />
      )}

      {showStudyModal && (
        <StudyModeModal
          deckId={deck.id}
          onClose={() => setShowStudyModal(false)}
        />
      )}

      {showCSVUpload && (
        <CSVUploadModal
          deck={deck}
          onClose={() => setShowCSVUpload(false)}
          onUpload={(newCards) => {
            setCards([...cards, ...newCards]);
            setShowCSVUpload(false);
          }}
        />
      )}

      {showJSONUpload && (
        <JSONUploadModal
          deck={deck}
          onClose={() => setShowJSONUpload(false)}
          onUpload={(newCards) => {
            setCards([...cards, ...newCards]);
            setShowJSONUpload(false);
          }}
        />
      )}

      {showEditDeck && (
        <EditDeckModal
          deck={deck}
          onClose={() => setShowEditDeck(false)}
          onSave={(updates) => {
            updateDeck(id!, updates);
            setDeck({ ...deck, ...updates });
            setShowEditDeck(false);
            toast.success('덱이 수정되었습니다.');
          }}
        />
      )}
    </div>
  );
}

function AddCardModal({
  deck,
  onClose,
  onCreate,
  editingCard,
}: {
  deck: Deck;
  onClose: () => void;
  onCreate: (data: Partial<Card>) => void;
  editingCard: Card | null;
}) {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(editingCard ? editingCard.fields : {});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    // Check if all required fields are filled
    const emptyFields = deck.fields.filter(f => !fieldValues[f.name]?.trim());
    if (emptyFields.length > 0) {
      toast.error('모든 필드를 입력해주세요.');
      return;
    }
    
    onCreate({ fields: fieldValues, tags: [] });
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>새 카드 추가</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {deck.fields.map((field) => (
            <div key={field.id}>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {field.name}
              </label>
              {field.type === 'text' ? (
                <textarea
                  value={fieldValues[field.name] || ''}
                  onChange={(e) => setFieldValues({ ...fieldValues, [field.name]: e.target.value })}
                  placeholder={`${field.name} 입력`}
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              ) : (
                <input
                  type="text"
                  value={fieldValues[field.name] || ''}
                  onChange={(e) => setFieldValues({ ...fieldValues, [field.name]: e.target.value })}
                  placeholder={`${field.name} 입력`}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              )}
            </div>
          ))}

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              저장
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCardModal({
  deck,
  card,
  onClose,
  onSave,
}: {
  deck: Deck;
  card: Card;
  onClose: () => void;
  onSave: (updates: Partial<Card>) => void;
}) {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(card.fields);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    // Check if all required fields are filled
    const emptyFields = deck.fields.filter(f => !fieldValues[f.name]?.trim());
    if (emptyFields.length > 0) {
      toast.error('모든 필드를 입력해주세요.');
      return;
    }
    
    onSave({ fields: fieldValues, tags: [] });
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>카드 수정</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {deck.fields.map((field) => (
            <div key={field.id}>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {field.name}
              </label>
              {field.type === 'text' ? (
                <textarea
                  value={fieldValues[field.name] || ''}
                  onChange={(e) => setFieldValues({ ...fieldValues, [field.name]: e.target.value })}
                  placeholder={`${field.name} 입력`}
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              ) : (
                <input
                  type="text"
                  value={fieldValues[field.name] || ''}
                  onChange={(e) => setFieldValues({ ...fieldValues, [field.name]: e.target.value })}
                  placeholder={`${field.name} 입력`}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              )}
            </div>
          ))}

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              저장
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDeckModal({
  deck,
  onClose,
  onSave,
}: {
  deck: Deck;
  onClose: () => void;
  onSave: (updates: Partial<Deck>) => void;
}) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  useEffect(() => {
    const data = getTemplates();
    setTemplates(data);
    if ((deck as any).templateId) {
      setSelectedTemplateId((deck as any).templateId);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('덱 이름을 입력해주세요.');
      return;
    }
    
    const updates: any = { name, description };
    
    // If template is selected, sync fields from template
    if (selectedTemplateId) {
      const template = getTemplate(selectedTemplateId);
      if (template) {
        updates.fields = template.fields;
        updates.frontLayout = template.frontLayout;
        updates.backLayout = template.backLayout;
        updates.templateId = selectedTemplateId;
      }
    }
    
    onSave(updates);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>덱 수정</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              덱 이름
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="덱 이름"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              설명
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="덱 설명 (선택사항)"
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="border-t pt-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              템플릿 선택
            </label>
            <p className="text-xs text-gray-500 mb-2">
              템플릿을 선택하면 해당 템플릿의 필드 구조가 적용됩니다. 기존 카드는 유지됩니다.
            </p>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="">템플릿 선택 안함</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.fields.length}개 필드)
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              저장
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CSVUploadModal({
  deck,
  onClose,
  onUpload,
}: {
  deck: Deck;
  onClose: () => void;
  onUpload: (cards: any[]) => void;
}) {
  const [csvText, setCSVText] = useState('');
  const [preview, setPreview] = useState<any[]>([]);

  function parseCSV(text: string) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return [];

    const cards = lines.map((line) => {
      const values = line.split(',').map(v => v.trim());
      const fields: Record<string, string> = {};
      
      // Map CSV columns to deck fields
      deck.fields.forEach((field, index) => {
        fields[field.name] = values[index] || '';
      });

      return {
        fields,
        tags: [],
        status: 'new' as const,
      };
    });

    return cards;
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCSVText(text);
      const cards = parseCSV(text);
      setPreview(cards.slice(0, 5)); // Show first 5 cards as preview
    };
    reader.readAsText(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!csvText.trim()) {
      toast.error('CSV 파일을 업로드하거나 텍스트를 입력해주세요.');
      return;
    }

    const cards = parseCSV(csvText);
    if (cards.length === 0) {
      toast.error('유효한 카드를 찾을 수 없습니다.');
      return;
    }

    // Create all cards
    const newCards = cards.map((card) => createCardStorage(deck.id, card));
    toast.success(`${newCards.length}개의 카드가 추가되었습니다!`);
    onUpload(newCards);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>CSV 업로드</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              CSV 파일 선택
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              형식: {deck.fields.map(f => f.name).join(', ')} (쉼표로 구분)
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              또는 직접 입력
            </label>
            <textarea
              value={csvText}
              onChange={(e) => {
                setCSVText(e.target.value);
                const cards = parseCSV(e.target.value);
                setPreview(cards.slice(0, 5));
              }}
              placeholder={`예:\n${deck.fields.map(f => f.name).join(', ')}\nHello, 안녕하세요\nThank you, 감사합니다`}
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm"
            />
          </div>

          {preview.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                미리보기 (처음 5개)
              </h4>
              <div className="space-y-2">
                {preview.map((card, index) => (
                  <div key={index} className="p-3 bg-gray-50 rounded-lg text-sm">
                    {Object.entries(card.fields).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {value as string}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {preview.length}개 카드 업로드
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function JSONUploadModal({
  deck,
  onClose,
  onUpload,
}: {
  deck: Deck;
  onClose: () => void;
  onUpload: (cards: any[]) => void;
}) {
  const [jsonText, setJSONText] = useState('');
  const [preview, setPreview] = useState<any[]>([]);

  function parseJSON(text: string) {
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        throw new Error('JSON 데이터는 배열이어야 합니다.');
      }

      const cards = data.map((item) => {
        const fields: Record<string, string> = {};
        
        // Map JSON keys to deck fields
        deck.fields.forEach((field) => {
          fields[field.name] = item[field.name] || '';
        });

        return {
          fields,
          tags: [],
          status: 'new' as const,
        };
      });

      return cards;
    } catch (error) {
      console.error('JSON 파싱 오류:', error);
      toast.error('유효한 JSON 데이터를 입력해주세요.');
      return [];
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setJSONText(text);
      const cards = parseJSON(text);
      setPreview(cards.slice(0, 5)); // Show first 5 cards as preview
    };
    reader.readAsText(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jsonText.trim()) {
      toast.error('JSON 파일을 업로드하거나 텍스트를 입력해주세요.');
      return;
    }

    const cards = parseJSON(jsonText);
    if (cards.length === 0) {
      toast.error('유효한 카드를 찾을 수 없습니다.');
      return;
    }

    // Create all cards
    const newCards = cards.map((card) => createCardStorage(deck.id, card));
    toast.success(`${newCards.length}개의 카드가 추가되었습니다!`);
    onUpload(newCards);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>JSON 업로드</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              JSON 파일 선택
            </label>
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              형식: {deck.fields.map(f => f.name).join(', ')} (쉼표로 구분)
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              또는 직접 입력
            </label>
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJSONText(e.target.value);
                const cards = parseJSON(e.target.value);
                setPreview(cards.slice(0, 5));
              }}
              placeholder={`예:\n${deck.fields.map(f => f.name).join(', ')}\nHello, 안녕하세요\nThank you, 감사합니다`}
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm"
            />
          </div>

          {preview.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                미리보기 (처음 5개)
              </h4>
              <div className="space-y-2">
                {preview.map((card, index) => (
                  <div key={index} className="p-3 bg-gray-50 rounded-lg text-sm">
                    {Object.entries(card.fields).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-medium">{key}:</span> {value as string}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {preview.length}개 카드 업로드
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}