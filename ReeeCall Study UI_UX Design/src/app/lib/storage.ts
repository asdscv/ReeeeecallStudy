// Local storage based data management
const STORAGE_KEYS = {
  USER: 'reeecall_user',
  DECKS: 'reeecall_decks',
  CARDS: 'reeecall_cards',
  TEMPLATES: 'reeecall_templates',
  SESSIONS: 'reeecall_sessions',
};

// User management
export function getCurrentUser() {
  const user = localStorage.getItem(STORAGE_KEYS.USER);
  return user ? JSON.parse(user) : null;
}

export function setCurrentUser(name: string) {
  const user = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  return user;
}

export function logout() {
  localStorage.removeItem(STORAGE_KEYS.USER);
}

// Deck management
export function getDecks() {
  const decks = localStorage.getItem(STORAGE_KEYS.DECKS);
  return decks ? JSON.parse(decks) : [];
}

export function getDeck(id: string) {
  const decks = getDecks();
  return decks.find((d: any) => d.id === id);
}

export function createDeck(deck: any) {
  const decks = getDecks();
  const newDeck = {
    ...deck,
    id: crypto.randomUUID(),
    // Add default template structure to deck
    fields: deck.fields || [
      { id: 'front', name: '앞면', type: 'text' },
      { id: 'back', name: '뒷면', type: 'text' },
    ],
    frontLayout: deck.frontLayout || [
      { fieldId: 'front' },
    ],
    backLayout: deck.backLayout || [
      { fieldId: 'front' },
      { fieldId: 'back' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  decks.push(newDeck);
  localStorage.setItem(STORAGE_KEYS.DECKS, JSON.stringify(decks));
  return newDeck;
}

export function updateDeck(id: string, updates: any) {
  const decks = getDecks();
  const index = decks.findIndex((d: any) => d.id === id);
  if (index !== -1) {
    decks[index] = {
      ...decks[index],
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.DECKS, JSON.stringify(decks));
    return decks[index];
  }
  return null;
}

export function deleteDeck(id: string) {
  const decks = getDecks();
  const filtered = decks.filter((d: any) => d.id !== id);
  localStorage.setItem(STORAGE_KEYS.DECKS, JSON.stringify(filtered));
  
  // Also delete all cards in this deck
  const cards = getCards(id);
  cards.forEach((card: any) => deleteCard(id, card.id));
}

// Card management
export function getCards(deckId: string) {
  const allCards = localStorage.getItem(STORAGE_KEYS.CARDS);
  const cards = allCards ? JSON.parse(allCards) : [];
  return cards.filter((c: any) => c.deckId === deckId);
}

export function getCard(deckId: string, cardId: string) {
  const cards = getCards(deckId);
  return cards.find((c: any) => c.id === cardId);
}

export function createCard(deckId: string, card: any) {
  const allCards = localStorage.getItem(STORAGE_KEYS.CARDS);
  const cards = allCards ? JSON.parse(allCards) : [];
  
  const newCard = {
    ...card,
    id: crypto.randomUUID(),
    deckId,
    status: 'new',
    nextReview: null,
    interval: 0,
    easeFactor: 2.5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  cards.push(newCard);
  localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(cards));
  return newCard;
}

export function updateCard(deckId: string, cardId: string, updates: any) {
  const allCards = localStorage.getItem(STORAGE_KEYS.CARDS);
  const cards = allCards ? JSON.parse(allCards) : [];
  
  const index = cards.findIndex((c: any) => c.id === cardId && c.deckId === deckId);
  if (index !== -1) {
    cards[index] = {
      ...cards[index],
      ...updates,
      id: cardId,
      deckId,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(cards));
    return cards[index];
  }
  return null;
}

export function deleteCard(deckId: string, cardId: string) {
  const allCards = localStorage.getItem(STORAGE_KEYS.CARDS);
  const cards = allCards ? JSON.parse(allCards) : [];
  const filtered = cards.filter((c: any) => !(c.id === cardId && c.deckId === deckId));
  localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(filtered));
}

// Template management
export function getTemplates() {
  const templates = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
  if (!templates) {
    // Initialize with default template
    const defaultTemplate = {
      id: 'default',
      name: '기본 템플릿',
      isDefault: true,
      fields: [
        { id: 'front', name: '앞면', type: 'text' },
        { id: 'back', name: '뒷면', type: 'text' },
      ],
      frontLayout: [
        { fieldId: 'front' },
      ],
      backLayout: [
        { fieldId: 'front' },
        { fieldId: 'back' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify([defaultTemplate]));
    return [defaultTemplate];
  }
  return JSON.parse(templates);
}

export function getTemplate(id: string) {
  const templates = getTemplates();
  return templates.find((t: any) => t.id === id);
}

export function createTemplate(template: any) {
  const templates = getTemplates();
  const newTemplate = {
    ...template,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  templates.push(newTemplate);
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
  return newTemplate;
}

export function updateTemplate(id: string, updates: any) {
  const templates = getTemplates();
  const index = templates.findIndex((t: any) => t.id === id);
  if (index !== -1) {
    templates[index] = {
      ...templates[index],
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
    return templates[index];
  }
  return null;
}

export function deleteTemplate(id: string) {
  const templates = getTemplates();
  const filtered = templates.filter((t: any) => t.id !== id);
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(filtered));
}

// Study session management
export function recordReview(deckId: string, cardId: string, rating: number) {
  const card = getCard(deckId, cardId);
  if (!card) return null;

  // Simple SRS algorithm (SM-2 inspired)
  let interval = card.interval || 0;
  let easeFactor = card.easeFactor || 2.5;
  let nextReview;

  if (rating === 1) { // Again
    interval = 0;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    nextReview = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  } else if (rating === 2) { // Hard
    interval = Math.max(1, interval * 1.2);
    easeFactor = Math.max(1.3, easeFactor - 0.15);
    nextReview = new Date(Date.now() + interval * 24 * 60 * 60 * 1000);
  } else if (rating === 3) { // Good
    if (interval === 0) {
      interval = 1;
    } else {
      interval = interval * easeFactor;
    }
    nextReview = new Date(Date.now() + interval * 24 * 60 * 60 * 1000);
  } else if (rating === 4) { // Easy
    if (interval === 0) {
      interval = 4;
    } else {
      interval = interval * easeFactor * 1.3;
    }
    easeFactor = easeFactor + 0.15;
    nextReview = new Date(Date.now() + interval * 24 * 60 * 60 * 1000);
  }

  const updatedCard = updateCard(deckId, cardId, {
    status: 'review',
    interval,
    easeFactor,
    nextReview: nextReview.toISOString(),
    lastReviewed: new Date().toISOString(),
  });

  // Record study session
  const today = new Date().toISOString().split('T')[0];
  const allSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
  const sessions = allSessions ? JSON.parse(allSessions) : {};
  
  if (!sessions[today]) {
    sessions[today] = { date: today, count: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0 } };
  }
  
  sessions[today].count += 1;
  sessions[today].ratings[rating] = (sessions[today].ratings[rating] || 0) + 1;
  localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));

  return updatedCard;
}

// Dashboard stats
export function getStats() {
  const today = new Date().toISOString().split('T')[0];
  const allSessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
  const sessions = allSessions ? JSON.parse(allSessions) : {};
  const todaySession = sessions[today] || { count: 0 };

  // Get all decks and cards
  const decks = getDecks();
  const allCards = localStorage.getItem(STORAGE_KEYS.CARDS);
  const cards = allCards ? JSON.parse(allCards) : [];
  
  // Count due cards
  let dueCards = 0;
  const now = new Date();
  for (const card of cards) {
    if (!card.nextReview || new Date(card.nextReview) <= now) {
      dueCards++;
    }
  }

  // Get heatmap data
  const heatmapData = Object.values(sessions).map((s: any) => ({
    date: s.date,
    count: s.count,
  }));

  return {
    todayCount: todaySession.count,
    totalCards: cards.length,
    dueCards,
    streak: 0, // TODO: Calculate streak
    heatmap: heatmapData,
  };
}