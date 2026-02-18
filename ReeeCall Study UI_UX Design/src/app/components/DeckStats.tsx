import { useEffect, useState } from 'react';
import { getCards } from '../lib/storage';
import { BarChart, TrendingUp, Clock, Target, Activity, Calendar } from 'lucide-react';

interface DeckStatsProps {
  deckId: string;
}

export function DeckStats({ deckId }: DeckStatsProps) {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    calculateStats();
  }, [deckId]);

  function calculateStats() {
    const cards = getCards(deckId);
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Count cards by status
    const newCards = cards.filter(c => c.status === 'new').length;
    const learningCards = cards.filter(c => c.status === 'learning').length;
    const reviewCards = cards.filter(c => c.status === 'review').length;
    const suspendedCards = cards.filter(c => c.status === 'suspended').length;

    // Count due cards
    const dueCards = cards.filter(c => {
      if (!c.nextReview) return c.status !== 'suspended';
      return new Date(c.nextReview) <= now && c.status !== 'suspended';
    }).length;

    // Calculate average interval for review cards
    let totalInterval = 0;
    let reviewCount = 0;
    cards.forEach(card => {
      if (card.nextReview && card.status === 'review') {
        const lastReview = card.lastReviewed || card.createdAt;
        const interval = Math.ceil((new Date(card.nextReview).getTime() - new Date(lastReview).getTime()) / (1000 * 60 * 60 * 24));
        if (interval > 0) {
          totalInterval += interval;
          reviewCount++;
        }
      }
    });
    const averageInterval = reviewCount > 0 ? Math.round(totalInterval / reviewCount) : 0;

    // Calculate accuracy rate from session data
    const allSessions = localStorage.getItem('reeecall-sessions');
    const sessions = allSessions ? JSON.parse(allSessions) : {};
    
    let totalRatings = 0;
    let goodRatings = 0;
    Object.values(sessions).forEach((session: any) => {
      if (session.ratings) {
        // Rating 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
        // Consider 3 and 4 as "correct"
        totalRatings += (session.ratings[1] || 0) + (session.ratings[2] || 0) + (session.ratings[3] || 0) + (session.ratings[4] || 0);
        goodRatings += (session.ratings[3] || 0) + (session.ratings[4] || 0);
      }
    });
    const accuracyRate = totalRatings > 0 ? Math.round((goodRatings / totalRatings) * 100) : 0;

    // Count cards studied today
    const todaySession = sessions[today];
    const studiedToday = todaySession ? todaySession.count : 0;

    // Count cards studied this week
    let studiedThisWeek = 0;
    Object.entries(sessions).forEach(([date, session]: [string, any]) => {
      if (new Date(date) >= weekAgo) {
        studiedThisWeek += session.count;
      }
    });

    // Get daily activity for last 30 days
    const dailyActivity: Array<{ date: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const session = sessions[dateStr];
      dailyActivity.push({
        date: dateStr,
        count: session ? session.count : 0,
      });
    }

    setStats({
      totalCards: cards.length,
      newCards,
      learningCards,
      reviewCards,
      suspendedCards,
      dueCards,
      averageInterval,
      accuracyRate,
      studiedToday,
      studiedThisWeek,
      dailyActivity,
    });
  }

  if (!stats) {
    return <div className="text-gray-500">통계를 계산하는 중...</div>;
  }

  const maxActivityCount = Math.max(...stats.dailyActivity.map((d: any) => d.count), 1);

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Target className="w-5 h-5 text-blue-600" />}
          label="복습 예정"
          value={stats.dueCards}
          total={stats.totalCards}
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-green-600" />}
          label="평균 복습 간격"
          value={`${stats.averageInterval}일`}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-purple-600" />}
          label="정답률"
          value={`${stats.accuracyRate}%`}
        />
        <StatCard
          icon={<Activity className="w-5 h-5 text-orange-600" />}
          label="이번 주 학습"
          value={`${stats.studiedThisWeek}장`}
        />
      </div>

      {/* Card Status Distribution */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <BarChart className="w-5 h-5" />
          카드 상태 분포
        </h3>
        <div className="space-y-3">
          <StatusBar label="새 카드" count={stats.newCards} total={stats.totalCards} color="bg-blue-600" />
          <StatusBar label="학습중" count={stats.learningCards} total={stats.totalCards} color="bg-amber-600" />
          <StatusBar label="복습" count={stats.reviewCards} total={stats.totalCards} color="bg-green-600" />
          <StatusBar label="보류" count={stats.suspendedCards} total={stats.totalCards} color="bg-gray-600" />
        </div>
      </div>

      {/* Daily Activity */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          최근 30일 학습 활동
        </h3>
        <div className="flex items-end gap-1 h-32">
          {stats.dailyActivity.map((day: any, index: number) => {
            const height = day.count > 0 ? (day.count / maxActivityCount) * 100 : 4;
            const isToday = day.date === new Date().toISOString().split('T')[0];
            
            return (
              <div
                key={index}
                className="flex-1 flex flex-col items-center justify-end group relative"
              >
                <div
                  className={`w-full rounded-t transition-all ${
                    day.count === 0
                      ? 'bg-gray-100'
                      : day.count <= 5
                      ? 'bg-blue-200'
                      : day.count <= 10
                      ? 'bg-blue-400'
                      : day.count <= 20
                      ? 'bg-blue-600'
                      : 'bg-blue-800'
                  } ${isToday ? 'ring-2 ring-blue-600' : ''}`}
                  style={{ height: `${height}%` }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                  {new Date(day.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}: {day.count}장
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <span>30일 전</span>
          <span>오늘</span>
        </div>
      </div>

      {/* Study Progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">학습 진행률</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">전체 진행률</span>
              <span className="text-sm text-gray-500">
                {stats.totalCards > 0
                  ? Math.round(((stats.learningCards + stats.reviewCards) / stats.totalCards) * 100)
                  : 0}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{
                  width: `${
                    stats.totalCards > 0
                      ? ((stats.learningCards + stats.reviewCards) / stats.totalCards) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{stats.studiedToday}</div>
              <div className="text-xs text-gray-600 mt-1">오늘 학습한 카드</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{stats.studiedThisWeek}</div>
              <div className="text-xs text-gray-600 mt-1">이번 주 학습한 카드</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  total,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  total?: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-bold text-gray-900">{value}</div>
          <div className="text-sm text-gray-500 truncate">{label}</div>
          {total !== undefined && (
            <div className="text-xs text-gray-400 mt-0.5">/ {total}장</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm text-gray-500">
          {count}장 ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
