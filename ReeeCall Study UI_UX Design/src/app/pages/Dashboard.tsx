import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, Calendar, TrendingUp, Flame } from 'lucide-react';
import { getStats, getDecks } from '../lib/storage';

interface Stats {
  todayCount: number;
  totalCards: number;
  dueCards: number;
  streak: number;
  heatmap: Array<{ date: string; count: number }>;
}

interface Deck {
  id: string;
  name: string;
  description?: string;
  cardCount?: number;
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    fetchDecks();
  }, []);

  function fetchStats() {
    try {
      const data = getStats();
      setStats(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  }

  function fetchDecks() {
    try {
      const data = getDecks();
      setDecks(data);
    } catch (error) {
      console.error('Error fetching decks:', error);
    }
  }

  if (loading) {
    return <div className="text-gray-500">로딩 중...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Calendar className="w-6 h-6 text-blue-600" />}
          value={stats?.todayCount || 0}
          label="오늘 학습한 카드"
        />
        <StatCard
          icon={<BookOpen className="w-6 h-6 text-purple-600" />}
          value={stats?.totalCards || 0}
          label="전체 카드 수"
        />
        <StatCard
          icon={<TrendingUp className="w-6 h-6 text-green-600" />}
          value={stats?.dueCards || 0}
          label="복습 예정 카드"
        />
        <StatCard
          icon={<Flame className="w-6 h-6 text-orange-600" />}
          value={stats?.streak || 0}
          label="연속 학습 일수"
        />
      </div>

      {/* Heatmap */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          학습 활동
        </h2>
        <HeatmapGrid data={stats?.heatmap || []} />
      </div>

      {/* Quick Start */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">내 덱</h2>
          <Link
            to="/decks"
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            모든 덱 보기 →
          </Link>
        </div>
        {decks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <BookOpen className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p>덱을 만들고 학습을 시작하세요!</p>
            <Link
              to="/decks"
              className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              덱 만들기
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {decks.slice(0, 6).map((deck) => (
              <Link
                key={deck.id}
                to={`/decks/${deck.id}`}
                className="p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{deck.name}</h3>
                </div>
                {deck.description && (
                  <p className="text-sm text-gray-500 mb-2 line-clamp-2">
                    {deck.description}
                  </p>
                )}
                <div className="text-xs text-gray-400">
                  {deck.cardCount || 0}개 카드
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{value}</div>
          <div className="text-sm text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  );
}

function HeatmapGrid({ data }: { data: Array<{ date: string; count: number }> }) {
  // Create a 365-day grid (simplified version)
  const getColor = (count: number) => {
    if (count === 0) return 'bg-gray-100';
    if (count <= 5) return 'bg-green-200';
    if (count <= 10) return 'bg-green-400';
    if (count <= 20) return 'bg-green-600';
    return 'bg-green-800';
  };

  // Create last 52 weeks
  const weeks = 52;
  const days = 7;
  const grid = [];

  for (let week = 0; week < weeks; week++) {
    const weekDays = [];
    for (let day = 0; day < days; day++) {
      const date = new Date();
      date.setDate(date.getDate() - (weeks - week) * 7 - (days - day));
      const dateStr = date.toISOString().split('T')[0];
      const dayData = data.find((d) => d.date === dateStr);
      weekDays.push({
        date: dateStr,
        count: dayData?.count || 0,
      });
    }
    grid.push(weekDays);
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex gap-1">
        {grid.map((week, weekIdx) => (
          <div key={weekIdx} className="flex flex-col gap-1">
            {week.map((day, dayIdx) => (
              <div
                key={dayIdx}
                className={`w-3 h-3 rounded-sm ${getColor(day.count)}`}
                title={`${day.date}: ${day.count}장 학습`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-4 text-xs text-gray-500">
        <span>적음</span>
        <div className="w-3 h-3 rounded-sm bg-gray-100" />
        <div className="w-3 h-3 rounded-sm bg-green-200" />
        <div className="w-3 h-3 rounded-sm bg-green-400" />
        <div className="w-3 h-3 rounded-sm bg-green-600" />
        <div className="w-3 h-3 rounded-sm bg-green-800" />
        <span>많음</span>
      </div>
    </div>
  );
}