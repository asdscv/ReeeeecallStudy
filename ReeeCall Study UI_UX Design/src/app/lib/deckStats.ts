// Deck Statistics Utility Functions
import { getCards } from './storage';

export interface DeckStats {
  totalCards: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
  suspendedCards: number;
  dueCards: number;
  averageInterval: number;
  accuracyRate: number;
  studiedToday: number;
  studiedThisWeek: number;
  dailyActivity: Array<{ date: string; count: number }>;
}

export function getDeckStats(deckId: string): DeckStats {
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
      const interval = Math.ceil((new Date(card.nextReview).getTime() - new Date(card.lastReviewed || card.createdAt).getTime()) / (1000 * 60 * 60 * 24));
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

  return {
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
  };
}
