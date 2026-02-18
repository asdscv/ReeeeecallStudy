// ─── API Docs Content — API 문서 페이지 데이터 (i18n keys) ──────────────────

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  summary: string
  description: string
  headers?: { name: string; value: string; required: boolean }[]
  pathParams?: { name: string; type: string; description: string }[]
  queryParams?: { name: string; type: string; required: boolean; description: string }[]
  requestBody?: string
  responseBody?: string
  statusCodes?: { code: number; description: string }[]
}

export interface ApiDocsSection {
  id: string
  title: string
  icon: string
  description: string
  endpoints?: ApiEndpoint[]
  items?: { title: string; body: string; isCode?: boolean }[]
}

export const API_BASE_URL = 'https://your-project.supabase.co/rest/v1'

export const API_DOCS_SECTIONS: ApiDocsSection[] = [
  // ───────────────────────────────────────────────────
  {
    id: 'overview',
    title: 'sections.overview.title',
    icon: '📡',
    description: 'sections.overview.description',
    items: [
      {
        title: 'sections.overview.items.what.title',
        body: 'sections.overview.items.what.body',
      },
      {
        title: 'sections.overview.items.baseUrl.title',
        body: 'sections.overview.items.baseUrl.body',
      },
      {
        title: 'sections.overview.items.responseFormat.title',
        body: 'sections.overview.items.responseFormat.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'authentication',
    title: 'sections.authentication.title',
    icon: '🔐',
    description: 'sections.authentication.description',
    items: [
      {
        title: 'sections.authentication.items.getKey.title',
        body: 'sections.authentication.items.getKey.body',
      },
      {
        title: 'sections.authentication.items.method.title',
        body: 'sections.authentication.items.method.body',
      },
      {
        title: 'sections.authentication.items.management.title',
        body: 'sections.authentication.items.management.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'rate-limits',
    title: 'sections.rateLimits.title',
    icon: '⏱️',
    description: 'sections.rateLimits.description',
    items: [
      {
        title: 'sections.rateLimits.items.free.title',
        body: 'sections.rateLimits.items.free.body',
      },
      {
        title: 'sections.rateLimits.items.pro.title',
        body: 'sections.rateLimits.items.pro.body',
      },
      {
        title: 'sections.rateLimits.items.exceeded.title',
        body: 'sections.rateLimits.items.exceeded.body',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'decks',
    title: 'sections.decks.title',
    icon: '📚',
    description: 'sections.decks.description',
    endpoints: [
      {
        method: 'GET',
        path: '/decks',
        summary: 'sections.decks.endpoints.list.summary',
        description: 'sections.decks.endpoints.list.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        queryParams: [
          { name: 'page', type: 'number', required: false, description: 'sections.decks.params.page' },
          { name: 'per_page', type: 'number', required: false, description: 'sections.decks.params.perPage' },
        ],
        responseBody: `[
  {
    "id": "uuid",
    "name": "영단어 기초",
    "description": "TOEIC 필수 영단어",
    "icon": "📚",
    "color": "#3B82F6",
    "card_count": 150,
    "created_at": "2025-01-15T09:00:00Z"
  }
]`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 429, description: 'sections.statusCodes.429' },
        ],
      },
      {
        method: 'GET',
        path: '/decks/:deckId',
        summary: 'sections.decks.endpoints.detail.summary',
        description: 'sections.decks.endpoints.detail.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: 'sections.decks.params.deckId' },
        ],
        responseBody: `{
  "id": "uuid",
  "name": "영단어 기초",
  "description": "TOEIC 필수 영단어",
  "icon": "📚",
  "color": "#3B82F6",
  "default_template_id": "uuid",
  "srs_settings": {
    "again_days": 0,
    "hard_days": 1,
    "good_days": 1,
    "easy_days": 4
  },
  "card_count": 150,
  "created_at": "2025-01-15T09:00:00Z",
  "updated_at": "2025-01-20T14:30:00Z"
}`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 404, description: 'sections.statusCodes.404' },
        ],
      },
      {
        method: 'POST',
        path: '/decks',
        summary: 'sections.decks.endpoints.create.summary',
        description: 'sections.decks.endpoints.create.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
          { name: 'Content-Type', value: 'application/json', required: true },
        ],
        requestBody: `{
  "name": "일본어 N3",
  "description": "JLPT N3 한자 & 문법",
  "icon": "🇯🇵",
  "color": "#EF4444"
}`,
        responseBody: `{
  "id": "new-uuid",
  "name": "일본어 N3",
  "description": "JLPT N3 한자 & 문법",
  "icon": "🇯🇵",
  "color": "#EF4444",
  "created_at": "2025-02-01T10:00:00Z"
}`,
        statusCodes: [
          { code: 201, description: 'sections.statusCodes.201' },
          { code: 400, description: 'sections.statusCodes.400' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 429, description: 'sections.statusCodes.429' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'cards',
    title: 'sections.cards.title',
    icon: '🃏',
    description: 'sections.cards.description',
    endpoints: [
      {
        method: 'GET',
        path: '/decks/:deckId/cards',
        summary: 'sections.cards.endpoints.list.summary',
        description: 'sections.cards.endpoints.list.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: 'sections.cards.params.deckId' },
        ],
        queryParams: [
          { name: 'page', type: 'number', required: false, description: 'sections.decks.params.page' },
          { name: 'per_page', type: 'number', required: false, description: 'sections.decks.params.perPage' },
          { name: 'status', type: 'string', required: false, description: 'sections.cards.params.status' },
          { name: 'tag', type: 'string', required: false, description: 'sections.cards.params.tag' },
        ],
        responseBody: `[
  {
    "id": "uuid",
    "template_id": "uuid",
    "field_values": {
      "front": "apple",
      "back": "사과"
    },
    "tags": ["과일", "기초"],
    "srs_status": "review",
    "ease_factor": 2.5,
    "interval_days": 7,
    "next_review_at": "2025-02-08T00:00:00Z",
    "created_at": "2025-01-10T08:00:00Z"
  }
]`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 404, description: 'sections.statusCodes.404' },
        ],
      },
      {
        method: 'POST',
        path: '/decks/:deckId/cards',
        summary: 'sections.cards.endpoints.create.summary',
        description: 'sections.cards.endpoints.create.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
          { name: 'Content-Type', value: 'application/json', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: 'sections.cards.params.deckId' },
        ],
        requestBody: `// 단일 카드
{
  "template_id": "uuid",
  "field_values": {
    "front": "banana",
    "back": "바나나"
  },
  "tags": ["과일"]
}

// 일괄 생성 (최대 100장)
[
  {
    "template_id": "uuid",
    "field_values": { "front": "cat", "back": "고양이" },
    "tags": ["동물"]
  },
  {
    "template_id": "uuid",
    "field_values": { "front": "dog", "back": "강아지" },
    "tags": ["동물"]
  }
]`,
        responseBody: `{
  "created": 2,
  "cards": [
    { "id": "uuid-1", "field_values": { "front": "cat", "back": "고양이" } },
    { "id": "uuid-2", "field_values": { "front": "dog", "back": "강아지" } }
  ]
}`,
        statusCodes: [
          { code: 201, description: 'sections.statusCodes.201' },
          { code: 400, description: 'sections.statusCodes.400' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 404, description: 'sections.statusCodes.404' },
          { code: 429, description: 'sections.statusCodes.429' },
        ],
      },
      {
        method: 'PATCH',
        path: '/decks/:deckId/cards/:cardId',
        summary: 'sections.cards.endpoints.update.summary',
        description: 'sections.cards.endpoints.update.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
          { name: 'Content-Type', value: 'application/json', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: 'sections.cards.params.deckId' },
          { name: 'cardId', type: 'string (UUID)', description: 'sections.cards.params.cardId' },
        ],
        requestBody: `{
  "field_values": {
    "front": "apple (fruit)",
    "back": "사과 (과일)"
  },
  "tags": ["과일", "수정됨"]
}`,
        responseBody: `{
  "id": "uuid",
  "field_values": {
    "front": "apple (fruit)",
    "back": "사과 (과일)"
  },
  "tags": ["과일", "수정됨"],
  "updated_at": "2025-02-01T12:00:00Z"
}`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 400, description: 'sections.statusCodes.400' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 404, description: 'sections.statusCodes.404' },
        ],
      },
      {
        method: 'DELETE',
        path: '/decks/:deckId/cards/:cardId',
        summary: 'sections.cards.endpoints.delete.summary',
        description: 'sections.cards.endpoints.delete.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: 'sections.cards.params.deckId' },
          { name: 'cardId', type: 'string (UUID)', description: 'sections.cards.params.cardId' },
        ],
        statusCodes: [
          { code: 204, description: 'sections.statusCodes.204' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 404, description: 'sections.statusCodes.404' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'study',
    title: 'sections.study.title',
    icon: '📖',
    description: 'sections.study.description',
    endpoints: [
      {
        method: 'GET',
        path: '/decks/:deckId/study/due',
        summary: 'sections.study.endpoints.due.summary',
        description: 'sections.study.endpoints.due.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: 'sections.study.params.deckId' },
        ],
        responseBody: `{
  "due_count": 12,
  "new_count": 5,
  "cards": [
    {
      "id": "uuid",
      "field_values": { "front": "apple", "back": "사과" },
      "srs_status": "review",
      "interval_days": 3,
      "next_review_at": "2025-02-01T00:00:00Z"
    }
  ]
}`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 404, description: 'sections.statusCodes.404' },
        ],
      },
      {
        method: 'GET',
        path: '/study/history',
        summary: 'sections.study.endpoints.history.summary',
        description: 'sections.study.endpoints.history.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        queryParams: [
          { name: 'deck_id', type: 'string (UUID)', required: false, description: 'sections.study.params.deckId' },
          { name: 'from', type: 'string (ISO date)', required: false, description: 'sections.study.params.from' },
          { name: 'to', type: 'string (ISO date)', required: false, description: 'sections.study.params.to' },
          { name: 'page', type: 'number', required: false, description: 'sections.decks.params.page' },
          { name: 'per_page', type: 'number', required: false, description: 'sections.decks.params.perPage' },
        ],
        responseBody: `[
  {
    "id": "uuid",
    "deck_id": "uuid",
    "study_mode": "srs",
    "cards_studied": 25,
    "total_duration_ms": 600000,
    "ratings": {
      "again": 3,
      "hard": 5,
      "good": 12,
      "easy": 5
    },
    "started_at": "2025-02-01T09:00:00Z",
    "completed_at": "2025-02-01T09:10:00Z"
  }
]`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
        ],
      },
      {
        method: 'GET',
        path: '/study/stats',
        summary: 'sections.study.endpoints.stats.summary',
        description: 'sections.study.endpoints.stats.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        queryParams: [
          { name: 'period', type: 'string', required: false, description: 'sections.study.params.period' },
        ],
        responseBody: `{
  "total_cards": 500,
  "cards_due_today": 23,
  "streak_days": 15,
  "mastery_rate": 0.72,
  "daily_counts": [
    { "date": "2025-01-30", "count": 45 },
    { "date": "2025-01-31", "count": 30 },
    { "date": "2025-02-01", "count": 50 }
  ]
}`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'templates',
    title: 'sections.templates.title',
    icon: '📋',
    description: 'sections.templates.description',
    endpoints: [
      {
        method: 'GET',
        path: '/templates',
        summary: 'sections.templates.endpoints.list.summary',
        description: 'sections.templates.endpoints.list.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        responseBody: `[
  {
    "id": "uuid",
    "name": "기본 (앞/뒤)",
    "fields": [
      { "key": "front", "name": "앞면", "type": "text", "order": 0 },
      { "key": "back", "name": "뒷면", "type": "text", "order": 1 }
    ],
    "is_default": true,
    "created_at": "2025-01-01T00:00:00Z"
  }
]`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
        ],
      },
      {
        method: 'GET',
        path: '/templates/:templateId',
        summary: 'sections.templates.endpoints.detail.summary',
        description: 'sections.templates.endpoints.detail.description',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'templateId', type: 'string (UUID)', description: 'sections.templates.params.templateId' },
        ],
        responseBody: `{
  "id": "uuid",
  "name": "영단어 상세",
  "fields": [
    { "key": "word", "name": "단어", "type": "text", "order": 0, "tts_enabled": true, "tts_lang": "en-US" },
    { "key": "meaning", "name": "뜻", "type": "text", "order": 1 },
    { "key": "example", "name": "예문", "type": "text", "order": 2 }
  ],
  "front_layout": [
    { "field_key": "word", "style": "primary", "font_size": 24 }
  ],
  "back_layout": [
    { "field_key": "meaning", "style": "primary", "font_size": 20 },
    { "field_key": "example", "style": "secondary", "font_size": 14 }
  ],
  "layout_mode": "default",
  "is_default": false,
  "created_at": "2025-01-05T12:00:00Z"
}`,
        statusCodes: [
          { code: 200, description: 'sections.statusCodes.200' },
          { code: 401, description: 'sections.statusCodes.401' },
          { code: 404, description: 'sections.statusCodes.404' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'examples',
    title: 'sections.examples.title',
    icon: '💻',
    description: 'sections.examples.description',
    items: [
      {
        title: 'cURL',
        body: '',
        isCode: true,
      },
      {
        title: 'JavaScript (fetch)',
        body: '',
        isCode: true,
      },
      {
        title: 'Python (requests)',
        body: '',
        isCode: true,
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'errors',
    title: 'sections.errors.title',
    icon: '⚠️',
    description: 'sections.errors.description',
    items: [
      {
        title: 'sections.errors.items.format.title',
        body: 'sections.errors.items.format.body',
      },
      {
        title: 'sections.errors.items.statusCodes.title',
        body: 'sections.errors.items.statusCodes.body',
      },
      {
        title: 'sections.errors.items.validation.title',
        body: 'sections.errors.items.validation.body',
      },
    ],
  },
]

/** Code examples — language-agnostic, kept as-is */
export const CODE_EXAMPLES: Record<string, { title: string; code: string }> = {
  curl: {
    title: 'cURL',
    code: `# 덱 목록 조회
curl -X GET "https://your-project.supabase.co/rest/v1/decks" \\
  -H "Authorization: Bearer rc_your_api_key"

# 카드 생성
curl -X POST "https://your-project.supabase.co/rest/v1/decks/{deckId}/cards" \\
  -H "Authorization: Bearer rc_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"template_id":"uuid","field_values":{"front":"hello","back":"안녕"}}'`,
  },
  javascript: {
    title: 'JavaScript (fetch)',
    code: `const API_KEY = process.env.REEEEECALL_API_KEY;
const BASE = "https://your-project.supabase.co/rest/v1";

// 덱 목록 조회
const decks = await fetch(\`\${BASE}/decks\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\` }
}).then(r => r.json());

// 카드 일괄 생성
const result = await fetch(\`\${BASE}/decks/\${deckId}/cards\`, {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify([
    { template_id: tid, field_values: { front: "cat", back: "고양이" } },
    { template_id: tid, field_values: { front: "dog", back: "강아지" } }
  ])
}).then(r => r.json());`,
  },
  python: {
    title: 'Python (requests)',
    code: `import os, requests

API_KEY = os.environ["REEEEECALL_API_KEY"]
BASE = "https://your-project.supabase.co/rest/v1"
headers = {"Authorization": f"Bearer {API_KEY}"}

# 덱 목록 조회
decks = requests.get(f"{BASE}/decks", headers=headers).json()

# 카드 생성
card = {
    "template_id": "uuid",
    "field_values": {"front": "hello", "back": "안녕하세요"},
    "tags": ["인사"]
}
result = requests.post(
    f"{BASE}/decks/{deck_id}/cards",
    headers={**headers, "Content-Type": "application/json"},
    json=card
).json()`,
  },
}

/** ID로 API 문서 섹션 찾기 */
export function getApiSection(id: string): ApiDocsSection | undefined {
  return API_DOCS_SECTIONS.find((s) => s.id === id)
}

/** 키워드 검색 — 매칭되는 섹션만 반환 (번역된 텍스트에서 검색) */
export function searchApiDocs(query: string, t: (key: string) => string): ApiDocsSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return API_DOCS_SECTIONS

  return API_DOCS_SECTIONS
    .map((section) => {
      const sectionMatch =
        t(section.title).toLowerCase().includes(q) ||
        t(section.description).toLowerCase().includes(q)

      // items 검색
      const matchingItems = section.items?.filter(
        (item) => {
          // code example items have literal titles, not i18n keys
          const titleText = item.isCode ? item.title : t(item.title)
          const bodyText = item.isCode ? (CODE_EXAMPLES[Object.keys(CODE_EXAMPLES).find(k => CODE_EXAMPLES[k].title === item.title) || '']?.code || '') : t(item.body)
          return (
            titleText.toLowerCase().includes(q) ||
            bodyText.toLowerCase().includes(q)
          )
        }
      )

      // endpoints 검색
      const matchingEndpoints = section.endpoints?.filter(
        (ep) =>
          t(ep.summary).toLowerCase().includes(q) ||
          t(ep.description).toLowerCase().includes(q) ||
          ep.path.toLowerCase().includes(q) ||
          ep.method.toLowerCase().includes(q)
      )

      if (sectionMatch) return section

      const hasMatchingItems = matchingItems && matchingItems.length > 0
      const hasMatchingEndpoints = matchingEndpoints && matchingEndpoints.length > 0

      if (hasMatchingItems || hasMatchingEndpoints) {
        return {
          ...section,
          ...(hasMatchingItems ? { items: matchingItems } : { items: undefined }),
          ...(hasMatchingEndpoints ? { endpoints: matchingEndpoints } : { endpoints: undefined }),
        }
      }

      return null
    })
    .filter((s): s is ApiDocsSection => s !== null)
}

/** HTTP Method에 따른 색상 반환 */
export function getMethodColor(method: ApiEndpoint['method']): string {
  const colors: Record<ApiEndpoint['method'], string> = {
    GET: 'bg-green-100 text-green-800',
    POST: 'bg-blue-100 text-blue-800',
    PUT: 'bg-yellow-100 text-yellow-800',
    PATCH: 'bg-orange-100 text-orange-800',
    DELETE: 'bg-red-100 text-red-800',
  }
  return colors[method]
}

/** 상태 코드에 따른 색상 반환 */
export function getStatusColor(code: number): string {
  if (code >= 200 && code < 300) return 'text-green-600'
  if (code >= 400 && code < 500) return 'text-yellow-600'
  return 'text-red-600'
}
