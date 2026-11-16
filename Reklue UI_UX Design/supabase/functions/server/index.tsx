import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
import { createClient } from "npm:@supabase/supabase-js@2";

const app = new Hono();

// Create Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-b4809ded/health", (c) => {
  return c.json({ status: "ok" });
});

// Deck endpoints
app.get("/make-server-b4809ded/decks", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const decks = await kv.getByPrefix(`user:${user.id}:deck:`);
    return c.json({ decks: decks || [] });
  } catch (error: any) {
    console.error('Error fetching decks:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.post("/make-server-b4809ded/decks", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const deckId = crypto.randomUUID();
    const deck = {
      id: deckId,
      userId: user.id,
      name: body.name,
      description: body.description || '',
      color: body.color || '#3B82F6',
      icon: body.icon || '📚',
      templateId: body.templateId || 'default',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`user:${user.id}:deck:${deckId}`, deck);
    return c.json({ deck });
  } catch (error: any) {
    console.error('Error creating deck:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.get("/make-server-b4809ded/decks/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const deckId = c.req.param('id');
    const deck = await kv.get(`user:${user.id}:deck:${deckId}`);
    
    if (!deck) {
      return c.json({ error: 'Deck not found' }, 404);
    }

    return c.json({ deck });
  } catch (error: any) {
    console.error('Error fetching deck:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.put("/make-server-b4809ded/decks/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const deckId = c.req.param('id');
    const existingDeck = await kv.get(`user:${user.id}:deck:${deckId}`);
    
    if (!existingDeck) {
      return c.json({ error: 'Deck not found' }, 404);
    }

    const body = await c.req.json();
    const deck = {
      ...existingDeck,
      ...body,
      id: deckId,
      userId: user.id,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`user:${user.id}:deck:${deckId}`, deck);
    return c.json({ deck });
  } catch (error: any) {
    console.error('Error updating deck:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.delete("/make-server-b4809ded/decks/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const deckId = c.req.param('id');
    await kv.del(`user:${user.id}:deck:${deckId}`);
    
    // Also delete all cards in this deck
    const cards = await kv.getByPrefix(`user:${user.id}:deck:${deckId}:card:`);
    const cardKeys = cards.map((card: any) => `user:${user.id}:deck:${deckId}:card:${card.id}`);
    if (cardKeys.length > 0) {
      await kv.mdel(cardKeys);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting deck:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Card endpoints
app.get("/make-server-b4809ded/decks/:deckId/cards", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const deckId = c.req.param('deckId');
    const cards = await kv.getByPrefix(`user:${user.id}:deck:${deckId}:card:`);
    return c.json({ cards: cards || [] });
  } catch (error: any) {
    console.error('Error fetching cards:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.post("/make-server-b4809ded/decks/:deckId/cards", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const deckId = c.req.param('deckId');
    const body = await c.req.json();
    const cardId = crypto.randomUUID();
    
    const card = {
      id: cardId,
      deckId,
      fields: body.fields,
      tags: body.tags || [],
      status: 'new',
      nextReview: null,
      interval: 0,
      easeFactor: 2.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`user:${user.id}:deck:${deckId}:card:${cardId}`, card);
    return c.json({ card });
  } catch (error: any) {
    console.error('Error creating card:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.put("/make-server-b4809ded/decks/:deckId/cards/:cardId", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const deckId = c.req.param('deckId');
    const cardId = c.req.param('cardId');
    const existingCard = await kv.get(`user:${user.id}:deck:${deckId}:card:${cardId}`);
    
    if (!existingCard) {
      return c.json({ error: 'Card not found' }, 404);
    }

    const body = await c.req.json();
    const card = {
      ...existingCard,
      ...body,
      id: cardId,
      deckId,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`user:${user.id}:deck:${deckId}:card:${cardId}`, card);
    return c.json({ card });
  } catch (error: any) {
    console.error('Error updating card:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.delete("/make-server-b4809ded/decks/:deckId/cards/:cardId", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const deckId = c.req.param('deckId');
    const cardId = c.req.param('cardId');
    await kv.del(`user:${user.id}:deck:${deckId}:card:${cardId}`);

    return c.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting card:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Template endpoints
app.get("/make-server-b4809ded/templates", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const templates = await kv.getByPrefix(`user:${user.id}:template:`);
    
    // Add default template if none exist
    if (!templates || templates.length === 0) {
      const defaultTemplate = {
        id: 'default',
        userId: user.id,
        name: '기본 템플릿',
        isDefault: true,
        fields: [
          { id: 'front', name: '앞면', type: 'text' },
          { id: 'back', name: '뒷면', type: 'text' },
        ],
        frontLayout: [
          { fieldId: 'front', style: 'primary' },
        ],
        backLayout: [
          { fieldId: 'front', style: 'secondary' },
          { fieldId: 'back', style: 'primary' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await kv.set(`user:${user.id}:template:default`, defaultTemplate);
      return c.json({ templates: [defaultTemplate] });
    }

    return c.json({ templates });
  } catch (error: any) {
    console.error('Error fetching templates:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.post("/make-server-b4809ded/templates", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const templateId = crypto.randomUUID();
    
    const template = {
      id: templateId,
      userId: user.id,
      name: body.name,
      isDefault: body.isDefault || false,
      fields: body.fields,
      frontLayout: body.frontLayout,
      backLayout: body.backLayout,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`user:${user.id}:template:${templateId}`, template);
    return c.json({ template });
  } catch (error: any) {
    console.error('Error creating template:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.get("/make-server-b4809ded/templates/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const templateId = c.req.param('id');
    const template = await kv.get(`user:${user.id}:template:${templateId}`);
    
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    return c.json({ template });
  } catch (error: any) {
    console.error('Error fetching template:', error);
    return c.json({ error: error.message }, 500);
  }
});

app.put("/make-server-b4809ded/templates/:id", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const templateId = c.req.param('id');
    const existingTemplate = await kv.get(`user:${user.id}:template:${templateId}`);
    
    if (!existingTemplate) {
      return c.json({ error: 'Template not found' }, 404);
    }

    const body = await c.req.json();
    const template = {
      ...existingTemplate,
      ...body,
      id: templateId,
      userId: user.id,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`user:${user.id}:template:${templateId}`, template);
    return c.json({ template });
  } catch (error: any) {
    console.error('Error updating template:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Study session endpoints
app.post("/make-server-b4809ded/study/review", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { deckId, cardId, rating } = body;

    const card = await kv.get(`user:${user.id}:deck:${deckId}:card:${cardId}`);
    if (!card) {
      return c.json({ error: 'Card not found' }, 404);
    }

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

    const updatedCard = {
      ...card,
      status: 'review',
      interval,
      easeFactor,
      nextReview: nextReview.toISOString(),
      lastReviewed: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`user:${user.id}:deck:${deckId}:card:${cardId}`, updatedCard);

    // Record study session
    const sessionKey = `user:${user.id}:session:${new Date().toISOString().split('T')[0]}`;
    const session = await kv.get(sessionKey) || { date: new Date().toISOString().split('T')[0], count: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0 } };
    session.count += 1;
    session.ratings[rating] = (session.ratings[rating] || 0) + 1;
    await kv.set(sessionKey, session);

    return c.json({ card: updatedCard });
  } catch (error: any) {
    console.error('Error recording review:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Dashboard stats
app.get("/make-server-b4809ded/stats", async (c) => {
  try {
    const accessToken = c.req.header('Authorization')?.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    
    if (!user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get today's session
    const today = new Date().toISOString().split('T')[0];
    const todaySession = await kv.get(`user:${user.id}:session:${today}`) || { count: 0 };

    // Get all decks to count cards
    const decks = await kv.getByPrefix(`user:${user.id}:deck:`);
    let totalCards = 0;
    let dueCards = 0;

    for (const deck of decks) {
      const cards = await kv.getByPrefix(`user:${user.id}:deck:${deck.id}:card:`);
      totalCards += cards.length;
      
      // Count due cards
      const now = new Date();
      for (const card of cards) {
        if (!card.nextReview || new Date(card.nextReview) <= now) {
          dueCards++;
        }
      }
    }

    // Get recent sessions for heatmap (last 365 days)
    const sessions = await kv.getByPrefix(`user:${user.id}:session:`);
    const heatmapData = sessions.map((s: any) => ({
      date: s.date,
      count: s.count,
    }));

    return c.json({
      todayCount: todaySession.count,
      totalCards,
      dueCards,
      streak: 0, // TODO: Calculate streak
      heatmap: heatmapData,
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    return c.json({ error: error.message }, 500);
  }
});

Deno.serve(app.fetch);