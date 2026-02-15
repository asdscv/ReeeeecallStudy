import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { getCards } from '../lib/storage';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface StudyModeModalProps {
  deckId: string;
  onClose: () => void;
}

export function StudyModeModal({ deckId, onClose }: StudyModeModalProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState('srs');
  const [cards, setCards] = useState<any[]>([]);
  
  // Settings for different modes
  const [newBatchSize, setNewBatchSize] = useState(100);
  const [reviewBatchSize, setReviewBatchSize] = useState(150);
  const [randomCount, setRandomCount] = useState(50);
  const [orderedCount, setOrderedCount] = useState(50);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [orderedPosition, setOrderedPosition] = useState(0);

  useEffect(() => {
    const allCards = getCards(deckId);
    setCards(allCards);
    
    // Load ordered position from localStorage
    const savedPosition = localStorage.getItem(`deck-${deckId}-ordered-position`);
    if (savedPosition) {
      setOrderedPosition(parseInt(savedPosition));
    }
  }, [deckId]);

  function getNewCards() {
    return cards.filter(c => c.status === 'new');
  }

  function getDueCards() {
    return cards.filter(c => {
      if (!c.nextReview) return true;
      return new Date(c.nextReview) <= new Date();
    });
  }

  function getDateCards() {
    if (!selectedDate) return [];
    const [year, month, day] = selectedDate.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const nextDay = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
    
    return cards.filter(c => {
      if (!c.createdAt) return false;
      const createdDate = new Date(c.createdAt);
      return createdDate >= targetDate && createdDate < nextDay;
    });
  }

  // Get dates that have cards
  function getDatesWithCards() {
    const datesSet = new Set<string>();
    cards.forEach(card => {
      if (card.createdAt) {
        const date = new Date(card.createdAt);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        datesSet.add(`${year}-${month}-${day}`);
      }
    });
    return datesSet;
  }

  function handleStart() {
    // Save settings to localStorage
    const settings = {
      mode,
      newBatchSize,
      reviewBatchSize,
      randomCount,
      orderedCount,
      selectedDate,
    };
    localStorage.setItem(`study-settings-${deckId}`, JSON.stringify(settings));
    
    // Navigate to study session
    navigate(`/study/${deckId}?mode=${mode}`);
  }

  const newCards = getNewCards();
  const dueCards = getDueCards();
  const dateCards = getDateCards();

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>학습 모드 선택</DialogTitle>
        </DialogHeader>
        
        {/* Total Cards Info */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl font-bold text-blue-900">{cards.length}</span>
            <span className="text-sm text-blue-700 font-medium">전체 카드</span>
          </div>
        </div>
        
        <div className="space-y-3">
          {/* SRS Mode */}
          <button
            onClick={() => setMode('srs')}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              mode === 'srs'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">🧠</div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">SRS (간격 반복)</div>
                <div className="text-sm text-gray-500 mb-2">잊을 때쯤 알아서 복습</div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                    복습 {dueCards.length}장
                  </span>
                  <span className="text-gray-400">+</span>
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
                    신규 {Math.min(newCards.length, 20)}장
                  </span>
                </div>
              </div>
            </div>
          </button>

          {/* Sequential Mode */}
          <button
            onClick={() => setMode('sequential')}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              mode === 'sequential'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">🔄</div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">순차 복습</div>
                <div className="text-sm text-gray-500 mb-3">새 카드 + 처음부터 복습</div>
                {mode === 'sequential' && (
                  <div className="space-y-2 pt-2 border-t">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        새 카드 배치 크기
                      </label>
                      <input
                        type="number"
                        value={newBatchSize}
                        onChange={(e) => setNewBatchSize(parseInt(e.target.value) || 100)}
                        onClick={(e) => e.stopPropagation()}
                        min={1}
                        max={500}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">
                        복습 배치 크기
                      </label>
                      <input
                        type="number"
                        value={reviewBatchSize}
                        onChange={(e) => setReviewBatchSize(parseInt(e.target.value) || 150)}
                        onClick={(e) => e.stopPropagation()}
                        min={1}
                        max={500}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </button>

          {/* Random Mode */}
          <button
            onClick={() => setMode('random')}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              mode === 'random'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">🎲</div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">랜덤</div>
                <div className="text-sm text-gray-500 mb-3">무작위로 섞어서 학습</div>
                {mode === 'random' && (
                  <div className="pt-2 border-t">
                    <label className="block text-xs text-gray-600 mb-1">
                      학습할 카드 수
                    </label>
                    <input
                      type="number"
                      value={randomCount}
                      onChange={(e) => setRandomCount(parseInt(e.target.value) || 50)}
                      onClick={(e) => e.stopPropagation()}
                      min={1}
                      max={cards.length}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      전체 {cards.length}장 중에서 선택
                    </p>
                  </div>
                )}
              </div>
            </div>
          </button>

          {/* Ordered Mode */}
          <button
            onClick={() => setMode('ordered')}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              mode === 'ordered'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">➡️</div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">순서대로</div>
                <div className="text-sm text-gray-500 mb-2">첫 카드부터 순서대로</div>
                <div className="text-xs font-medium text-blue-600 mb-3">
                  현재 위치: {orderedPosition}번째 / 전체 {cards.length}장
                </div>
                {mode === 'ordered' && (
                  <div className="pt-2 border-t">
                    <label className="block text-xs text-gray-600 mb-1">
                      학습할 카드 수
                    </label>
                    <input
                      type="number"
                      value={orderedCount}
                      onChange={(e) => setOrderedCount(parseInt(e.target.value) || 50)}
                      onClick={(e) => e.stopPropagation()}
                      min={1}
                      max={Math.max(0, cards.length - orderedPosition)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      남은 카드: {Math.max(0, cards.length - orderedPosition)}장
                    </p>
                  </div>
                )}
              </div>
            </div>
          </button>

          {/* Date-based Study Mode */}
          <button
            onClick={() => setMode('date')}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
              mode === 'date'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">📅</div>
              <div className="flex-1">
                <div className="font-medium text-gray-900">일자별 학습</div>
                <div className="text-sm text-gray-500 mb-3">특정 날짜에 업로드한 카드 학습</div>
                {mode === 'date' && (
                  <div className="pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                    <label className="block text-xs text-gray-600 mb-2">
                      업로드 날짜 선택
                    </label>
                    <DatePicker
                      selectedDate={selectedDate}
                      onSelectDate={setSelectedDate}
                      datesWithCards={getDatesWithCards()}
                    />
                    <div className="mt-2 text-xs font-medium text-blue-600">
                      {selectedDate && (() => {
                        const [year, month, day] = selectedDate.split('-').map(Number);
                        return `${year}년 ${month}월 ${day}일`;
                      })()} 업로드: {dateCards.length}장
                    </div>
                  </div>
                )}
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={handleStart}
          disabled={
            (mode === 'srs' && dueCards.length === 0 && newCards.length === 0) ||
            (mode === 'random' && cards.length === 0) ||
            (mode === 'ordered' && orderedPosition >= cards.length) ||
            (mode === 'date' && dateCards.length === 0)
          }
          className="w-full mt-4 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          학습 시작
        </button>
      </DialogContent>
    </Dialog>
  );
}

// Custom Date Picker Component
function DatePicker({
  selectedDate,
  onSelectDate,
  datesWithCards,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  datesWithCards: Set<string>;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const date = new Date(selectedDate);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });

  const daysInMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0
  ).getDate();

  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  ).getDay();

  const prevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    );
  };

  const nextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    );
  };

  const handleDateClick = (day: number) => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    onSelectDate(`${year}-${month}-${dayStr}`);
  };

  const renderDays = () => {
    const days = [];
    const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const day = i - firstDayOfMonth + 1;
      const isValidDay = day > 0 && day <= daysInMonth;
      
      if (isValidDay) {
        const year = currentMonth.getFullYear();
        const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateString = `${year}-${month}-${dayStr}`;
        
        const hasCards = datesWithCards.has(dateString);
        const isSelected = dateString === selectedDate;
        
        // Today's date in local timezone
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const isToday = dateString === todayStr;

        days.push(
          <button
            key={i}
            onClick={() => handleDateClick(day)}
            className={`
              aspect-square flex items-center justify-center text-sm rounded-lg transition-colors
              ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
              ${!isSelected && hasCards ? 'bg-gray-100 text-gray-900 font-semibold hover:bg-gray-200' : ''}
              ${!isSelected && !hasCards ? 'text-gray-300 hover:bg-gray-50' : ''}
              ${isToday && !isSelected ? 'ring-2 ring-blue-400' : ''}
            `}
          >
            {day}
          </button>
        );
      } else {
        days.push(<div key={i} />);
      }
    }

    return days;
  };

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-3">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="font-medium text-sm">
          {currentMonth.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
          })}
        </div>
        <button
          onClick={nextMonth}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
          <div
            key={day}
            className="aspect-square flex items-center justify-center text-xs font-medium text-gray-500"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">{renderDays()}</div>
    </div>
  );
}