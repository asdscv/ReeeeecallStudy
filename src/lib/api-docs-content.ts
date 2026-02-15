// ─── API Docs Content — API 문서 페이지 데이터 ──────────────────

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
  items?: { title: string; body: string }[]
}

export const API_BASE_URL = 'https://your-project.supabase.co/rest/v1'

export const API_DOCS_SECTIONS: ApiDocsSection[] = [
  // ───────────────────────────────────────────────────
  {
    id: 'overview',
    title: '개요',
    icon: '📡',
    description: 'ReeeeecallStudy API를 사용하면 외부 도구, 스크립트, 앱에서 학습 데이터를 관리할 수 있습니다.',
    items: [
      {
        title: 'API란?',
        body: 'ReeeeecallStudy API는 RESTful API로, HTTP 요청을 통해 덱, 카드, 학습 기록 등의 데이터를 조회하고 관리할 수 있습니다. 자동화 스크립트, 서드파티 앱 연동, 데이터 분석 등에 활용할 수 있습니다.',
      },
      {
        title: 'Base URL',
        body: '모든 API 요청의 기본 URL은 Supabase 프로젝트 URL을 기반으로 합니다.\n\nBase URL: https://your-project.supabase.co/rest/v1',
      },
      {
        title: '응답 형식',
        body: '모든 응답은 JSON 형식으로 반환됩니다. Content-Type은 application/json입니다.\n\n성공 시 해당 리소스의 데이터가 반환되고, 오류 시 { "error": "메시지" } 형식으로 반환됩니다.',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'authentication',
    title: '인증',
    icon: '🔐',
    description: 'API 키를 사용하여 모든 요청을 인증합니다.',
    items: [
      {
        title: 'API 키 발급',
        body: '설정 페이지 → API 키 섹션에서 "새 API 키 생성" 버튼을 클릭합니다.\n키 이름(최대 64자)을 입력하고 생성하면 rc_ 로 시작하는 35자리 키가 발급됩니다.\n\n⚠️ 키는 생성 시 한 번만 표시됩니다. 반드시 안전한 곳에 복사해두세요!',
      },
      {
        title: '인증 방법',
        body: '모든 API 요청의 Authorization 헤더에 Bearer 토큰으로 API 키를 전달합니다.\n\nAuthorization: Bearer rc_your_api_key_here\n\nAPI 키가 없거나 잘못된 경우 401 Unauthorized 오류가 반환됩니다.',
      },
      {
        title: '키 관리',
        body: '• 최대 1개의 API 키를 보유할 수 있습니다\n• 키를 분실한 경우 기존 키를 삭제하고 새로 생성합니다\n• 사용하지 않는 키는 즉시 삭제하세요\n• 키를 코드에 직접 포함하지 말고 환경 변수로 관리하세요',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'rate-limits',
    title: '요청 제한',
    icon: '⏱️',
    description: 'API 안정성을 위해 요청 수가 제한됩니다.',
    items: [
      {
        title: 'Free 티어',
        body: '• 일일 API 요청: 1,000건\n• 분당 API 호출: 60회\n• 분당 카드 생성: 30건\n• 분당 일괄 카드 생성: 5회 (회당 최대 100장)\n• 총 카드 수: 5,000개\n• 총 덱 수: 50개',
      },
      {
        title: 'Pro 티어',
        body: '• 일일 API 요청: 10,000건\n• 분당 API 호출: 300회\n• 분당 카드 생성: 120건\n• 분당 일괄 카드 생성: 20회\n• 총 카드 수: 50,000개\n• 총 덱 수: 500개',
      },
      {
        title: '제한 초과 시',
        body: '요청 제한에 도달하면 429 Too Many Requests 응답이 반환됩니다.\n\n응답 헤더에 포함된 정보:\n• X-RateLimit-Limit: 최대 요청 수\n• X-RateLimit-Remaining: 남은 요청 수\n• Retry-After: 재시도까지 대기 시간(초)',
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'decks',
    title: '덱 API',
    icon: '📚',
    description: '덱(카드 묶음)을 조회하고 관리합니다.',
    endpoints: [
      {
        method: 'GET',
        path: '/decks',
        summary: '덱 목록 조회',
        description: '사용자의 모든 덱 목록을 조회합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        queryParams: [
          { name: 'page', type: 'number', required: false, description: '페이지 번호 (기본: 1)' },
          { name: 'per_page', type: 'number', required: false, description: '페이지당 항목 수 (기본: 50, 최대: 100)' },
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
          { code: 429, description: '요청 제한 초과' },
        ],
      },
      {
        method: 'GET',
        path: '/decks/:deckId',
        summary: '덱 상세 조회',
        description: '특정 덱의 상세 정보를 조회합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: '조회할 덱의 ID' },
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
          { code: 404, description: '덱을 찾을 수 없음' },
        ],
      },
      {
        method: 'POST',
        path: '/decks',
        summary: '새 덱 생성',
        description: '새로운 덱을 생성합니다.',
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
          { code: 201, description: '생성 성공' },
          { code: 400, description: '잘못된 요청 (필수 필드 누락)' },
          { code: 401, description: '인증 실패' },
          { code: 429, description: '요청 제한 초과' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'cards',
    title: '카드 API',
    icon: '🃏',
    description: '카드를 조회, 생성, 수정합니다.',
    endpoints: [
      {
        method: 'GET',
        path: '/decks/:deckId/cards',
        summary: '카드 목록 조회',
        description: '특정 덱에 속한 카드 목록을 조회합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: '덱 ID' },
        ],
        queryParams: [
          { name: 'page', type: 'number', required: false, description: '페이지 번호 (기본: 1)' },
          { name: 'per_page', type: 'number', required: false, description: '페이지당 항목 수 (기본: 50, 최대: 100)' },
          { name: 'status', type: 'string', required: false, description: 'SRS 상태 필터 (new, learning, review, suspended)' },
          { name: 'tag', type: 'string', required: false, description: '태그 필터' },
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
          { code: 404, description: '덱을 찾을 수 없음' },
        ],
      },
      {
        method: 'POST',
        path: '/decks/:deckId/cards',
        summary: '카드 생성',
        description: '덱에 새 카드를 추가합니다. 단일 카드 또는 배열로 최대 100장까지 일괄 생성 가능합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
          { name: 'Content-Type', value: 'application/json', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: '덱 ID' },
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
          { code: 201, description: '생성 성공' },
          { code: 400, description: '잘못된 요청 (유효성 검증 실패)' },
          { code: 401, description: '인증 실패' },
          { code: 404, description: '덱을 찾을 수 없음' },
          { code: 429, description: '요청 제한 초과' },
        ],
      },
      {
        method: 'PATCH',
        path: '/decks/:deckId/cards/:cardId',
        summary: '카드 수정',
        description: '기존 카드의 필드 값이나 태그를 수정합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
          { name: 'Content-Type', value: 'application/json', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: '덱 ID' },
          { name: 'cardId', type: 'string (UUID)', description: '카드 ID' },
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
          { code: 200, description: '수정 성공' },
          { code: 400, description: '잘못된 요청' },
          { code: 401, description: '인증 실패' },
          { code: 404, description: '카드를 찾을 수 없음' },
        ],
      },
      {
        method: 'DELETE',
        path: '/decks/:deckId/cards/:cardId',
        summary: '카드 삭제',
        description: '특정 카드를 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: '덱 ID' },
          { name: 'cardId', type: 'string (UUID)', description: '카드 ID' },
        ],
        statusCodes: [
          { code: 204, description: '삭제 성공 (응답 본문 없음)' },
          { code: 401, description: '인증 실패' },
          { code: 404, description: '카드를 찾을 수 없음' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'study',
    title: '학습 API',
    icon: '📖',
    description: '학습 기록을 조회하고 학습 세션 데이터를 관리합니다.',
    endpoints: [
      {
        method: 'GET',
        path: '/decks/:deckId/study/due',
        summary: '복습 예정 카드 조회',
        description: '오늘 복습해야 할 카드 목록을 조회합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'deckId', type: 'string (UUID)', description: '덱 ID' },
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
          { code: 404, description: '덱을 찾을 수 없음' },
        ],
      },
      {
        method: 'GET',
        path: '/study/history',
        summary: '학습 기록 조회',
        description: '학습 세션 기록을 조회합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        queryParams: [
          { name: 'deck_id', type: 'string (UUID)', required: false, description: '특정 덱의 기록만 조회' },
          { name: 'from', type: 'string (ISO date)', required: false, description: '시작 날짜 (예: 2025-01-01)' },
          { name: 'to', type: 'string (ISO date)', required: false, description: '종료 날짜 (예: 2025-01-31)' },
          { name: 'page', type: 'number', required: false, description: '페이지 번호' },
          { name: 'per_page', type: 'number', required: false, description: '페이지당 항목 수' },
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
        ],
      },
      {
        method: 'GET',
        path: '/study/stats',
        summary: '학습 통계 조회',
        description: '전체 학습 통계와 대시보드 데이터를 조회합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        queryParams: [
          { name: 'period', type: 'string', required: false, description: '기간 (1w, 1m, 3m, 6m, 1y)' },
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'templates',
    title: '템플릿 API',
    icon: '📋',
    description: '카드 템플릿을 조회합니다.',
    endpoints: [
      {
        method: 'GET',
        path: '/templates',
        summary: '템플릿 목록 조회',
        description: '사용자의 모든 카드 템플릿 목록을 조회합니다.',
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
        ],
      },
      {
        method: 'GET',
        path: '/templates/:templateId',
        summary: '템플릿 상세 조회',
        description: '특정 템플릿의 전체 정보(필드, 레이아웃 포함)를 조회합니다.',
        headers: [
          { name: 'Authorization', value: 'Bearer rc_...', required: true },
        ],
        pathParams: [
          { name: 'templateId', type: 'string (UUID)', description: '템플릿 ID' },
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
          { code: 200, description: '성공' },
          { code: 401, description: '인증 실패' },
          { code: 404, description: '템플릿을 찾을 수 없음' },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'examples',
    title: '코드 예시',
    icon: '💻',
    description: '다양한 언어와 도구로 API를 호출하는 예시입니다.',
    items: [
      {
        title: 'cURL',
        body: `# 덱 목록 조회
curl -X GET "https://your-project.supabase.co/rest/v1/decks" \\
  -H "Authorization: Bearer rc_your_api_key"

# 카드 생성
curl -X POST "https://your-project.supabase.co/rest/v1/decks/{deckId}/cards" \\
  -H "Authorization: Bearer rc_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"template_id":"uuid","field_values":{"front":"hello","back":"안녕"}}'`,
      },
      {
        title: 'JavaScript (fetch)',
        body: `const API_KEY = process.env.REEEEECALL_API_KEY;
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
      {
        title: 'Python (requests)',
        body: `import os, requests

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
    ],
  },

  // ───────────────────────────────────────────────────
  {
    id: 'errors',
    title: '오류 처리',
    icon: '⚠️',
    description: '에러 응답의 형식과 일반적인 오류 코드를 안내합니다.',
    items: [
      {
        title: '오류 응답 형식',
        body: `모든 오류는 다음 형식으로 반환됩니다:\n\n{\n  "error": "오류 메시지",\n  "code": "ERROR_CODE",\n  "details": "추가 정보 (선택)"\n}`,
      },
      {
        title: '주요 HTTP 상태 코드',
        body: '• 200 OK — 요청 성공\n• 201 Created — 리소스 생성 성공\n• 204 No Content — 삭제 성공 (응답 본문 없음)\n• 400 Bad Request — 잘못된 요청 (필수 필드 누락, 유효성 검증 실패)\n• 401 Unauthorized — 인증 실패 (API 키 없거나 잘못됨)\n• 404 Not Found — 리소스를 찾을 수 없음\n• 429 Too Many Requests — 요청 제한 초과\n• 500 Internal Server Error — 서버 내부 오류',
      },
      {
        title: '유효성 검증 오류',
        body: '카드 생성/수정 시 유효성 검증에 실패하면 각 필드별 오류 메시지가 배열로 반환됩니다:\n\n{\n  "error": "Validation failed",\n  "errors": [\n    "[0] template_id is required",\n    "[0] field_values must have at least one field"\n  ]\n}',
      },
    ],
  },
]

/** ID로 API 문서 섹션 찾기 */
export function getApiSection(id: string): ApiDocsSection | undefined {
  return API_DOCS_SECTIONS.find((s) => s.id === id)
}

/** 키워드 검색 — 매칭되는 섹션만 반환 */
export function searchApiDocs(query: string): ApiDocsSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return API_DOCS_SECTIONS

  return API_DOCS_SECTIONS
    .map((section) => {
      const sectionMatch =
        section.title.toLowerCase().includes(q) ||
        section.description.toLowerCase().includes(q)

      // items 검색
      const matchingItems = section.items?.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.body.toLowerCase().includes(q)
      )

      // endpoints 검색
      const matchingEndpoints = section.endpoints?.filter(
        (ep) =>
          ep.summary.toLowerCase().includes(q) ||
          ep.description.toLowerCase().includes(q) ||
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
