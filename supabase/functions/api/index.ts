// deno-lint-ignore-file no-explicit-any
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
import { createClient } from '@supabase/supabase-js'
import { rateLimitMiddleware } from './middleware/rate-limit.ts'

// ─── Helpers ──────────────────────────────────────────────────

function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── Zod Schemas ──────────────────────────────────────────────

// Common
const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'NOT_FOUND' }),
      message: z.string().openapi({ example: 'Resource not found' }),
    }),
  })
  .openapi('Error')

const SuccessDeleteSchema = z
  .object({
    data: z.object({
      deleted: z.boolean().openapi({ example: true }),
    }),
  })
  .openapi('SuccessDelete')

const PaginationSchema = z
  .object({
    page: z.number().int().openapi({ example: 1 }),
    per_page: z.number().int().openapi({ example: 50 }),
    total: z.number().int().openapi({ example: 120 }),
  })
  .openapi('Pagination')

// Params
const DeckIdParamSchema = z.object({
  deckId: z.string().uuid().openapi({ example: 'a1b2c3d4-0000-0000-0000-000000000000', param: { name: 'deckId', in: 'path' } }),
})

const CardIdParamSchema = z.object({
  cardId: z.string().uuid().openapi({ example: 'b2c3d4e5-0000-0000-0000-000000000000', param: { name: 'cardId', in: 'path' } }),
})

const TemplateIdParamSchema = z.object({
  templateId: z.string().uuid().openapi({ example: 'c3d4e5f6-0000-0000-0000-000000000000', param: { name: 'templateId', in: 'path' } }),
})

// Query
const PageQuerySchema = z.object({
  page: z.string().optional().openapi({ example: '1', param: { name: 'page', in: 'query' } }),
  per_page: z.string().optional().openapi({ example: '50', param: { name: 'per_page', in: 'query' } }),
})

// Profile
const ProfileSchema = z
  .object({
    id: z.string().uuid().openapi({ example: 'u1234567-0000-0000-0000-000000000000' }),
    display_name: z.string().nullable().openapi({ example: 'John Doe' }),
    daily_new_limit: z.number().int().openapi({ example: 20 }),
    tts_enabled: z.boolean().openapi({ example: false }),
    created_at: z.string().openapi({ example: '2025-01-01T00:00:00Z' }),
  })
  .openapi('Profile')

// Deck
const SrsSettingsSchema = z.object({
  again_days: z.number().openapi({ example: 0 }),
  hard_days: z.number().openapi({ example: 1 }),
  good_days: z.number().openapi({ example: 1 }),
  easy_days: z.number().openapi({ example: 4 }),
})

const DeckSchema = z
  .object({
    id: z.string().uuid().openapi({ example: 'a1b2c3d4-0000-0000-0000-000000000000' }),
    name: z.string().openapi({ example: '영어 단어장' }),
    description: z.string().nullable().openapi({ example: 'TOEIC 필수 단어' }),
    color: z.string().openapi({ example: '#3B82F6' }),
    icon: z.string().openapi({ example: '📚' }),
    is_archived: z.boolean().openapi({ example: false }),
    srs_settings: SrsSettingsSchema,
    created_at: z.string().openapi({ example: '2025-01-01T00:00:00Z' }),
    updated_at: z.string().openapi({ example: '2025-01-01T00:00:00Z' }),
  })
  .openapi('Deck')

const CreateDeckBodySchema = z
  .object({
    name: z.string().min(1).max(100).openapi({ example: '영어 단어장' }),
    description: z.string().max(500).optional().openapi({ example: 'TOEIC 필수 단어' }),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#3B82F6').openapi({ example: '#3B82F6' }),
    icon: z.string().max(10).optional().default('📚').openapi({ example: '📚' }),
    default_template_id: z.string().uuid().optional().openapi({ example: 'c3d4e5f6-0000-0000-0000-000000000000' }),
    srs_settings: SrsSettingsSchema.optional(),
  })
  .openapi('CreateDeckBody')

const DeckStatsSchema = z.object({
  total_cards: z.number().int().openapi({ example: 100 }),
  new_cards: z.number().int().openapi({ example: 20 }),
  due_cards: z.number().int().openapi({ example: 15 }),
})

const DeckWithStatsSchema = DeckSchema.extend({
  user_id: z.string().uuid().optional(),
  default_template_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
  next_position: z.number().int().optional(),
  stats: DeckStatsSchema,
}).openapi('DeckWithStats')

// Card
const CardSchema = z
  .object({
    id: z.string().uuid().openapi({ example: 'b2c3d4e5-0000-0000-0000-000000000000' }),
    deck_id: z.string().uuid().openapi({ example: 'a1b2c3d4-0000-0000-0000-000000000000' }),
    user_id: z.string().uuid(),
    template_id: z.string().uuid(),
    field_values: z.record(z.string()).openapi({ example: { front: 'apple', back: '사과' } }),
    tags: z.array(z.string()).openapi({ example: ['fruit', 'easy'] }),
    sort_position: z.number().int(),
    srs_status: z.enum(['new', 'learning', 'review', 'suspended']).openapi({ example: 'new' }),
    ease_factor: z.number(),
    interval_days: z.number().int(),
    repetitions: z.number().int(),
    next_review_at: z.string().nullable(),
    last_reviewed_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Card')

const CreateCardItemSchema = z.object({
  template_id: z.string().uuid().openapi({ example: 'c3d4e5f6-0000-0000-0000-000000000000' }),
  field_values: z.record(z.string(), z.string()).openapi({ example: { front: 'apple', back: '사과' } }),
  tags: z.array(z.string()).optional().openapi({ example: ['fruit'] }),
})

const CreateCardBodySchema = z.union([
  CreateCardItemSchema,
  z.array(CreateCardItemSchema).min(1).max(100),
]).openapi('CreateCardBody')

// Template
const TemplateFieldSchema = z.object({
  key: z.string().openapi({ example: 'front' }),
  name: z.string().openapi({ example: 'Front' }),
  type: z.enum(['text', 'image', 'audio']).openapi({ example: 'text' }),
  order: z.number().int().openapi({ example: 0 }),
  detail: z.string().optional().openapi({ example: '카드의 앞면에 표시될 내용' }),
  tts_enabled: z.boolean().optional().openapi({ example: false }),
  tts_lang: z.string().optional().openapi({ example: 'en-US' }),
})

const LayoutItemSchema = z.object({
  field_key: z.string().openapi({ example: 'front' }),
  style: z.enum(['primary', 'secondary', 'hint', 'detail', 'media']).openapi({ example: 'primary' }),
  font_size: z.number().optional().openapi({ example: 24 }),
})

const TemplateSchema = z
  .object({
    id: z.string().uuid().openapi({ example: 'c3d4e5f6-0000-0000-0000-000000000000' }),
    user_id: z.string().uuid(),
    name: z.string().openapi({ example: '기본 템플릿' }),
    fields: z.array(TemplateFieldSchema),
    front_layout: z.array(LayoutItemSchema),
    back_layout: z.array(LayoutItemSchema),
    is_default: z.boolean().openapi({ example: true }),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Template')

const CreateTemplateBodySchema = z
  .object({
    name: z.string().min(1).openapi({ example: '나의 템플릿' }),
    fields: z.array(TemplateFieldSchema).min(1),
    front_layout: z.array(LayoutItemSchema).optional(),
    back_layout: z.array(LayoutItemSchema).optional(),
  })
  .openapi('CreateTemplateBody')

const UpdateTemplateBodySchema = z
  .object({
    name: z.string().min(1).optional().openapi({ example: '수정된 템플릿' }),
    fields: z.array(TemplateFieldSchema).min(1).optional(),
    front_layout: z.array(LayoutItemSchema).optional(),
    back_layout: z.array(LayoutItemSchema).optional(),
  })
  .openapi('UpdateTemplateBody')

// ─── Route Definitions ───────────────────────────────────────

const getProfileRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  tags: ['Profile'],
  summary: '내 프로필 조회',
  description: `현재 API 키 소유자의 프로필을 조회합니다. 프로필이 없으면 자동 생성됩니다.

\`\`\`bash
curl -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/me
\`\`\``,
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: '프로필 조회 성공',
      content: { 'application/json': { schema: z.object({ data: ProfileSchema }) } },
    },
    401: { description: '인증 실패 — API 키 누락 또는 유효하지 않음', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '프로필을 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const listDecksRoute = createRoute({
  method: 'get',
  path: '/v1/decks',
  tags: ['Decks'],
  summary: '덱 목록 조회',
  description: `아카이브되지 않은 모든 덱을 정렬 순서대로 조회합니다.

\`\`\`bash
curl -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/decks
\`\`\``,
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: '덱 목록 조회 성공',
      content: { 'application/json': { schema: z.object({ data: z.array(DeckSchema) }) } },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const getDeckRoute = createRoute({
  method: 'get',
  path: '/v1/decks/{deckId}',
  tags: ['Decks'],
  summary: '덱 상세 조회 (통계 포함)',
  description: `특정 덱의 상세 정보와 카드 통계(전체/신규/복습 예정)를 함께 조회합니다.

\`\`\`bash
curl -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/decks/<deckId>
\`\`\`

**에러 코드:**
- \`NOT_FOUND\` — 덱이 존재하지 않거나 소유권 불일치`,
  security: [{ Bearer: [] }],
  request: { params: DeckIdParamSchema },
  responses: {
    200: {
      description: '덱 상세 + 통계 조회 성공',
      content: { 'application/json': { schema: z.object({ data: DeckWithStatsSchema }) } },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '덱을 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const createDeckRoute = createRoute({
  method: 'post',
  path: '/v1/decks',
  tags: ['Decks'],
  summary: '덱 생성',
  description: `새 덱을 생성합니다.

\`\`\`bash
curl -X POST -H "Authorization: Bearer rc_xxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"영어 단어장","color":"#3B82F6","icon":"📚"}' \\
  https://<host>/api/v1/decks
\`\`\``,
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateDeckBodySchema } } },
  },
  responses: {
    201: {
      description: '덱 생성 성공',
      content: { 'application/json': { schema: z.object({ data: DeckSchema }) } },
    },
    400: { description: 'Validation 에러', content: { 'application/json': { schema: ErrorSchema } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const listCardsRoute = createRoute({
  method: 'get',
  path: '/v1/decks/{deckId}/cards',
  tags: ['Cards'],
  summary: '덱의 카드 목록 조회 (페이지네이션)',
  description: `특정 덱에 속한 카드를 페이지네이션으로 조회합니다.

\`\`\`bash
curl -H "Authorization: Bearer rc_xxxxx" "https://<host>/api/v1/decks/<deckId>/cards?page=1&per_page=50"
\`\`\`

**페이지네이션:**
- \`page\`: 페이지 번호 (기본값: 1, 최소: 1)
- \`per_page\`: 페이지당 항목 수 (기본값: 50, 최소: 1, 최대: 100)`,
  security: [{ Bearer: [] }],
  request: { params: DeckIdParamSchema, query: PageQuerySchema },
  responses: {
    200: {
      description: '카드 목록 조회 성공',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(CardSchema), pagination: PaginationSchema }),
        },
      },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '덱을 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const getCardRoute = createRoute({
  method: 'get',
  path: '/v1/cards/{cardId}',
  tags: ['Cards'],
  summary: '카드 상세 조회',
  description: `카드 ID로 특정 카드의 상세 정보를 조회합니다.

\`\`\`bash
curl -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/cards/<cardId>
\`\`\``,
  security: [{ Bearer: [] }],
  request: { params: CardIdParamSchema },
  responses: {
    200: {
      description: '카드 상세 조회 성공',
      content: { 'application/json': { schema: z.object({ data: CardSchema }) } },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '카드를 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const deleteCardRoute = createRoute({
  method: 'delete',
  path: '/v1/cards/{cardId}',
  tags: ['Cards'],
  summary: '카드 삭제',
  description: `카드 ID로 특정 카드를 삭제합니다.

\`\`\`bash
curl -X DELETE -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/cards/<cardId>
\`\`\``,
  security: [{ Bearer: [] }],
  request: { params: CardIdParamSchema },
  responses: {
    200: {
      description: '카드 삭제 성공',
      content: { 'application/json': { schema: SuccessDeleteSchema } },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '카드를 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const createCardsRoute = createRoute({
  method: 'post',
  path: '/v1/decks/{deckId}/cards',
  tags: ['Cards'],
  summary: '카드 생성 (단일 또는 배치)',
  description: `덱에 카드를 생성합니다. 단일 객체 또는 배열(최대 100개)을 전달할 수 있습니다.

\`\`\`bash
# 단일 카드
curl -X POST -H "Authorization: Bearer rc_xxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"template_id":"...","field_values":{"front":"apple","back":"사과"}}' \\
  https://<host>/api/v1/decks/<deckId>/cards

# 배치 (최대 100개)
curl -X POST -H "Authorization: Bearer rc_xxxxx" \\
  -H "Content-Type: application/json" \\
  -d '[{"template_id":"...","field_values":{"front":"apple","back":"사과"}}]' \\
  https://<host>/api/v1/decks/<deckId>/cards
\`\`\`

**배치 규칙:**
- 최소 1개, 최대 100개
- 각 항목에 \`template_id\`와 \`field_values\`(1개 이상) 필수`,
  security: [{ Bearer: [] }],
  request: {
    params: DeckIdParamSchema,
    body: { content: { 'application/json': { schema: CreateCardBodySchema } } },
  },
  responses: {
    201: {
      description: '카드 생성 성공',
      content: { 'application/json': { schema: z.object({ data: z.array(CardSchema) }) } },
    },
    400: { description: 'Validation 에러', content: { 'application/json': { schema: ErrorSchema } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '덱을 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const listTemplatesRoute = createRoute({
  method: 'get',
  path: '/v1/templates',
  tags: ['Templates'],
  summary: '템플릿 목록 조회',
  description: `사용자의 모든 카드 템플릿을 생성일 순으로 조회합니다.

\`\`\`bash
curl -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/templates
\`\`\``,
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: '템플릿 목록 조회 성공',
      content: { 'application/json': { schema: z.object({ data: z.array(TemplateSchema) }) } },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const getTemplateRoute = createRoute({
  method: 'get',
  path: '/v1/templates/{templateId}',
  tags: ['Templates'],
  summary: '템플릿 상세 조회',
  description: `특정 템플릿의 상세 정보를 조회합니다.

\`\`\`bash
curl -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/templates/<templateId>
\`\`\``,
  security: [{ Bearer: [] }],
  request: { params: TemplateIdParamSchema },
  responses: {
    200: {
      description: '템플릿 상세 조회 성공',
      content: { 'application/json': { schema: z.object({ data: TemplateSchema }) } },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '템플릿을 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const createTemplateRoute = createRoute({
  method: 'post',
  path: '/v1/templates',
  tags: ['Templates'],
  summary: '템플릿 생성',
  description: `새 카드 템플릿을 생성합니다.

\`\`\`bash
curl -X POST -H "Authorization: Bearer rc_xxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"나의 템플릿","fields":[{"key":"front","name":"Front","type":"text","order":0}]}' \\
  https://<host>/api/v1/templates
\`\`\``,
  security: [{ Bearer: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateTemplateBodySchema } } },
  },
  responses: {
    201: {
      description: '템플릿 생성 성공',
      content: { 'application/json': { schema: z.object({ data: TemplateSchema }) } },
    },
    400: { description: 'Validation 에러', content: { 'application/json': { schema: ErrorSchema } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const updateTemplateRoute = createRoute({
  method: 'patch',
  path: '/v1/templates/{templateId}',
  tags: ['Templates'],
  summary: '템플릿 수정',
  description: `기존 템플릿을 부분 수정합니다. 전달된 필드만 업데이트됩니다.

\`\`\`bash
curl -X PATCH -H "Authorization: Bearer rc_xxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"수정된 이름"}' \\
  https://<host>/api/v1/templates/<templateId>
\`\`\``,
  security: [{ Bearer: [] }],
  request: {
    params: TemplateIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateTemplateBodySchema } } },
  },
  responses: {
    200: {
      description: '템플릿 수정 성공',
      content: { 'application/json': { schema: z.object({ data: TemplateSchema }) } },
    },
    400: { description: 'Validation 에러 — 수정할 필드 없음 등', content: { 'application/json': { schema: ErrorSchema } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '템플릿을 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const deleteTemplateRoute = createRoute({
  method: 'delete',
  path: '/v1/templates/{templateId}',
  tags: ['Templates'],
  summary: '템플릿 삭제',
  description: `템플릿을 삭제합니다. 해당 템플릿을 사용하는 카드가 있으면 삭제할 수 없습니다.

\`\`\`bash
curl -X DELETE -H "Authorization: Bearer rc_xxxxx" https://<host>/api/v1/templates/<templateId>
\`\`\`

**에러 코드:**
- \`TEMPLATE_IN_USE\` (409) — 카드가 이 템플릿을 참조 중. 카드를 먼저 재할당하세요.`,
  security: [{ Bearer: [] }],
  request: { params: TemplateIdParamSchema },
  responses: {
    200: {
      description: '템플릿 삭제 성공',
      content: { 'application/json': { schema: SuccessDeleteSchema } },
    },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '템플릿을 찾을 수 없음', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: '카드가 이 템플릿을 사용 중', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

// ─── App Setup ────────────────────────────────────────────────

type Env = { Variables: { userId: string; supabase: any } }

const app = new OpenAPIHono<Env>({ defaultHook: (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      },
      400,
    )
  }
}}).basePath('/api')

// ─── Middleware ────────────────────────────────────────────────

app.use('*', cors())

app.use('/v1/*', async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const match = header.match(/^bearer\s+(\S+)$/i)
  if (!match) {
    return c.json({ error: { code: 'MISSING_API_KEY', message: 'Authorization: Bearer <api_key> required' } }, 401)
  }

  const keyHash = await hashKey(match[1])
  const sb = supabaseAdmin()

  const { data, error } = await sb.rpc('resolve_api_key', { p_key_hash: keyHash })
  if (error || !data) {
    return c.json({ error: { code: 'INVALID_API_KEY', message: 'Invalid or expired API key' } }, 401)
  }

  c.set('userId', data as string)
  c.set('supabase', sb)
  await next()
})

app.use('/v1/*', rateLimitMiddleware)

// ─── Route Handlers ───────────────────────────────────────────

// GET /v1/me
app.openapi(getProfileRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')

  const { data, error } = await sb
    .from('profiles')
    .select('id, display_name, daily_new_limit, tts_enabled, created_at')
    .eq('id', userId)
    .single()

  if (error || !data) {
    const { data: created, error: createErr } = await sb
      .from('profiles')
      .upsert({ id: userId }, { onConflict: 'id' })
      .select('id, display_name, daily_new_limit, tts_enabled, created_at')
      .single()

    if (createErr || !created) return c.json({ error: { code: 'NOT_FOUND', message: 'Profile not found' } }, 404)
    return c.json({ data: created }, 200)
  }

  return c.json({ data }, 200)
})

// GET /v1/decks
app.openapi(listDecksRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')

  const { data, error } = await sb
    .from('decks')
    .select('id, name, description, color, icon, is_archived, srs_settings, created_at, updated_at')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: data ?? [] }, 200)
})

// POST /v1/decks
app.openapi(createDeckRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const body = c.req.valid('json')

  const { data: deck, error } = await sb
    .from('decks')
    .insert({
      user_id: userId,
      name: body.name.trim(),
      description: body.description || null,
      color: body.color || '#3B82F6',
      icon: body.icon || '📚',
      default_template_id: body.default_template_id || null,
      srs_settings: body.srs_settings,
    })
    .select('id, name, description, color, icon, is_archived, srs_settings, created_at, updated_at')
    .single()

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: deck }, 201)
})

// GET /v1/decks/{deckId}
app.openapi(getDeckRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { deckId } = c.req.valid('param')

  const { data: deck, error } = await sb
    .from('decks')
    .select('*')
    .eq('id', deckId)
    .eq('user_id', userId)
    .single()

  if (error || !deck) return c.json({ error: { code: 'NOT_FOUND', message: 'Deck not found' } }, 404)

  const { count: totalCards } = await sb
    .from('cards')
    .select('*', { count: 'exact', head: true })
    .eq('deck_id', deckId)

  const { count: newCards } = await sb
    .from('cards')
    .select('*', { count: 'exact', head: true })
    .eq('deck_id', deckId)
    .eq('srs_status', 'new')

  const now = new Date().toISOString()
  const { count: dueCards } = await sb
    .from('cards')
    .select('*', { count: 'exact', head: true })
    .eq('deck_id', deckId)
    .in('srs_status', ['learning', 'review'])
    .lte('next_review_at', now)

  return c.json({
    data: {
      ...deck,
      stats: {
        total_cards: totalCards ?? 0,
        new_cards: newCards ?? 0,
        due_cards: dueCards ?? 0,
      },
    },
  }, 200)
})

// GET /v1/decks/{deckId}/cards
app.openapi(listCardsRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { deckId } = c.req.valid('param')
  const query = c.req.valid('query')

  // Verify deck ownership
  const { data: deck } = await sb
    .from('decks')
    .select('id')
    .eq('id', deckId)
    .eq('user_id', userId)
    .single()
  if (!deck) return c.json({ error: { code: 'NOT_FOUND', message: 'Deck not found' } }, 404)

  // Pagination
  const rawPage = parseInt(query.page ?? '1', 10)
  const rawPerPage = parseInt(query.per_page ?? '50', 10)
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1)
  const perPage = Math.max(1, Math.min(100, Number.isFinite(rawPerPage) ? rawPerPage : 50))
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  const { data: cards, error, count } = await sb
    .from('cards')
    .select('*', { count: 'exact' })
    .eq('deck_id', deckId)
    .order('sort_position', { ascending: true })
    .range(from, to)

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)

  return c.json({
    data: cards ?? [],
    pagination: {
      page,
      per_page: perPage,
      total: count ?? 0,
    },
  }, 200)
})

// GET /v1/cards/{cardId}
app.openapi(getCardRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { cardId } = c.req.valid('param')

  const { data: card, error } = await sb
    .from('cards')
    .select('*')
    .eq('id', cardId)
    .eq('user_id', userId)
    .single()

  if (error || !card) return c.json({ error: { code: 'NOT_FOUND', message: 'Card not found' } }, 404)
  return c.json({ data: card }, 200)
})

// DELETE /v1/cards/{cardId}
app.openapi(deleteCardRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { cardId } = c.req.valid('param')

  const { data: card } = await sb
    .from('cards')
    .select('id')
    .eq('id', cardId)
    .eq('user_id', userId)
    .single()

  if (!card) return c.json({ error: { code: 'NOT_FOUND', message: 'Card not found' } }, 404)

  const { error } = await sb
    .from('cards')
    .delete()
    .eq('id', cardId)
    .eq('user_id', userId)

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: { deleted: true } }, 200)
})

// POST /v1/decks/{deckId}/cards
app.openapi(createCardsRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { deckId } = c.req.valid('param')
  const body = c.req.valid('json')

  // Verify deck ownership and get next_position
  const { data: deck } = await sb
    .from('decks')
    .select('id, next_position')
    .eq('id', deckId)
    .eq('user_id', userId)
    .single()
  if (!deck) return c.json({ error: { code: 'NOT_FOUND', message: 'Deck not found' } }, 404)

  // Normalize to array
  const items: any[] = Array.isArray(body) ? body : [body]

  // Build insert rows
  let pos = deck.next_position as number
  const rows = items.map((item: any) => ({
    deck_id: deckId,
    user_id: userId,
    template_id: item.template_id,
    field_values: item.field_values,
    tags: item.tags ?? [],
    sort_position: pos++,
  }))

  const { data: created, error } = await sb
    .from('cards')
    .insert(rows)
    .select()

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)

  // Update deck.next_position
  await sb
    .from('decks')
    .update({ next_position: pos })
    .eq('id', deckId)

  return c.json({ data: created }, 201)
})

// GET /v1/templates
app.openapi(listTemplatesRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')

  const { data, error } = await sb
    .from('card_templates')
    .select('id, name, fields, front_layout, back_layout, is_default, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: data ?? [] }, 200)
})

// GET /v1/templates/{templateId}
app.openapi(getTemplateRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { templateId } = c.req.valid('param')

  const { data, error } = await sb
    .from('card_templates')
    .select('*')
    .eq('id', templateId)
    .eq('user_id', userId)
    .single()

  if (error || !data) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404)
  return c.json({ data }, 200)
})

// POST /v1/templates
app.openapi(createTemplateRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const body = c.req.valid('json')

  const { data, error } = await sb
    .from('card_templates')
    .insert({
      user_id: userId,
      name: body.name.trim(),
      fields: body.fields,
      front_layout: body.front_layout ?? [],
      back_layout: body.back_layout ?? [],
    })
    .select()
    .single()

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data }, 201)
})

// PATCH /v1/templates/{templateId}
app.openapi(updateTemplateRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { templateId } = c.req.valid('param')
  const body = c.req.valid('json')

  // Verify ownership
  const { data: existing } = await sb
    .from('card_templates')
    .select('id')
    .eq('id', templateId)
    .eq('user_id', userId)
    .single()
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404)

  // Build update payload (only supplied fields)
  const update: Record<string, any> = {}
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.fields !== undefined) update.fields = body.fields
  if (body.front_layout !== undefined) update.front_layout = body.front_layout
  if (body.back_layout !== undefined) update.back_layout = body.back_layout

  if (Object.keys(update).length === 0) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } }, 400)
  }

  const { data, error } = await sb
    .from('card_templates')
    .update(update)
    .eq('id', templateId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data }, 200)
})

// DELETE /v1/templates/{templateId}
app.openapi(deleteTemplateRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { templateId } = c.req.valid('param')

  // Check if any cards use this template
  const { count } = await sb
    .from('cards')
    .select('*', { count: 'exact', head: true })
    .eq('template_id', templateId)
    .eq('user_id', userId)

  if (count && count > 0) {
    return c.json(
      {
        error: {
          code: 'TEMPLATE_IN_USE',
          message: `Cannot delete: ${count} card(s) use this template. Reassign cards first.`,
        },
      },
      409,
    )
  }

  const { error } = await sb
    .from('card_templates')
    .delete()
    .eq('id', templateId)
    .eq('user_id', userId)

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: { deleted: true } }, 200)
})

// ─── Marketplace & Sharing Schemas ───────────────────────────

const MarketplaceListingSchema = z.object({
  id: z.string().uuid(),
  deck_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  category: z.string(),
  share_mode: z.enum(['copy', 'subscribe', 'snapshot']),
  card_count: z.number().int(),
  acquire_count: z.number().int(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi('MarketplaceListing')

const DeckShareSchema = z.object({
  id: z.string().uuid(),
  deck_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  recipient_id: z.string().uuid().nullable(),
  share_mode: z.enum(['copy', 'subscribe', 'snapshot']),
  status: z.enum(['pending', 'active', 'revoked', 'declined']),
  invite_code: z.string().nullable(),
  invite_email: z.string().nullable(),
  copied_deck_id: z.string().uuid().nullable(),
  created_at: z.string(),
  accepted_at: z.string().nullable(),
}).openapi('DeckShare')

const ListingIdParamSchema = z.object({
  listingId: z.string().uuid().openapi({ param: { name: 'listingId', in: 'path' } }),
})

const ShareIdParamSchema = z.object({
  shareId: z.string().uuid().openapi({ param: { name: 'shareId', in: 'path' } }),
})

// ─── Marketplace Route Definitions ──────────────────────────

const listMarketplaceRoute = createRoute({
  method: 'get',
  path: '/v1/marketplace',
  tags: ['Marketplace'],
  summary: '마켓플레이스 리스팅 목록',
  security: [{ Bearer: [] }],
  responses: {
    200: { description: '리스팅 목록', content: { 'application/json': { schema: z.object({ data: z.array(MarketplaceListingSchema) }) } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const getMarketplaceRoute = createRoute({
  method: 'get',
  path: '/v1/marketplace/{listingId}',
  tags: ['Marketplace'],
  summary: '리스팅 상세 조회',
  security: [{ Bearer: [] }],
  request: { params: ListingIdParamSchema },
  responses: {
    200: { description: '리스팅 상세', content: { 'application/json': { schema: z.object({ data: MarketplaceListingSchema }) } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '리스팅 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const createMarketplaceRoute = createRoute({
  method: 'post',
  path: '/v1/marketplace',
  tags: ['Marketplace'],
  summary: '덱을 마켓에 게시',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            deck_id: z.string().uuid(),
            title: z.string().min(1),
            description: z.string().optional(),
            tags: z.array(z.string()).optional(),
            category: z.string().optional(),
            share_mode: z.enum(['copy', 'subscribe', 'snapshot']),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: '게시 성공', content: { 'application/json': { schema: z.object({ data: MarketplaceListingSchema }) } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const deleteMarketplaceRoute = createRoute({
  method: 'delete',
  path: '/v1/marketplace/{listingId}',
  tags: ['Marketplace'],
  summary: '게시 취소',
  security: [{ Bearer: [] }],
  request: { params: ListingIdParamSchema },
  responses: {
    200: { description: '게시 취소 성공', content: { 'application/json': { schema: SuccessDeleteSchema } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '리스팅 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

// ─── Sharing Route Definitions ──────────────────────────────

const createShareRoute = createRoute({
  method: 'post',
  path: '/v1/shares',
  tags: ['Sharing'],
  summary: '공유 생성',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            deck_id: z.string().uuid(),
            share_mode: z.enum(['copy', 'subscribe', 'snapshot']),
            invite_email: z.string().optional(),
            generate_link: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: '공유 생성 성공', content: { 'application/json': { schema: z.object({ data: DeckShareSchema }) } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const acceptShareRoute = createRoute({
  method: 'post',
  path: '/v1/shares/accept',
  tags: ['Sharing'],
  summary: '초대 수락',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            invite_code: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: '수락 성공', content: { 'application/json': { schema: z.object({ data: z.object({ deck_id: z.string().uuid() }) }) } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '초대 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const listSharesRoute = createRoute({
  method: 'get',
  path: '/v1/shares',
  tags: ['Sharing'],
  summary: '내 공유 목록',
  security: [{ Bearer: [] }],
  responses: {
    200: { description: '공유 목록', content: { 'application/json': { schema: z.object({ data: z.object({ sent: z.array(DeckShareSchema), received: z.array(DeckShareSchema) }) }) } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

const deleteShareRoute = createRoute({
  method: 'delete',
  path: '/v1/shares/{shareId}',
  tags: ['Sharing'],
  summary: '공유 취소/구독 해지',
  security: [{ Bearer: [] }],
  request: { params: ShareIdParamSchema },
  responses: {
    200: { description: '취소 성공', content: { 'application/json': { schema: SuccessDeleteSchema } } },
    401: { description: '인증 실패', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '공유 없음', content: { 'application/json': { schema: ErrorSchema } } },
  },
})

// ─── Marketplace Handlers ────────────────────────────────────

// GET /v1/marketplace
app.openapi(listMarketplaceRoute, async (c) => {
  const sb = c.get('supabase')
  const { data, error } = await sb
    .from('marketplace_listings')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: data ?? [] }, 200)
})

// GET /v1/marketplace/{listingId}
app.openapi(getMarketplaceRoute, async (c) => {
  const sb = c.get('supabase')
  const { listingId } = c.req.valid('param')

  const { data, error } = await sb
    .from('marketplace_listings')
    .select('*')
    .eq('id', listingId)
    .single()

  if (error || !data) return c.json({ error: { code: 'NOT_FOUND', message: 'Listing not found' } }, 404)
  return c.json({ data }, 200)
})

// POST /v1/marketplace
app.openapi(createMarketplaceRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const body = c.req.valid('json')

  // Verify deck ownership
  const { data: deck } = await sb.from('decks').select('id').eq('id', body.deck_id).eq('user_id', userId).single()
  if (!deck) return c.json({ error: { code: 'NOT_FOUND', message: 'Deck not found' } }, 404)

  // Get card count
  const { count } = await sb.from('cards').select('*', { count: 'exact', head: true }).eq('deck_id', body.deck_id)

  const { data, error } = await sb
    .from('marketplace_listings')
    .insert({
      deck_id: body.deck_id,
      owner_id: userId,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      tags: body.tags ?? [],
      category: body.category ?? 'general',
      share_mode: body.share_mode,
      card_count: count ?? 0,
      is_active: true,
    })
    .select()
    .single()

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data }, 201)
})

// DELETE /v1/marketplace/{listingId}
app.openapi(deleteMarketplaceRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { listingId } = c.req.valid('param')

  const { data: listing } = await sb.from('marketplace_listings').select('id').eq('id', listingId).eq('owner_id', userId).single()
  if (!listing) return c.json({ error: { code: 'NOT_FOUND', message: 'Listing not found' } }, 404)

  const { error } = await sb.from('marketplace_listings').update({ is_active: false }).eq('id', listingId)
  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: { deleted: true } }, 200)
})

// ─── Sharing Handlers ────────────────────────────────────────

// POST /v1/shares
app.openapi(createShareRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const body = c.req.valid('json')

  // Verify deck ownership
  const { data: deck } = await sb.from('decks').select('id').eq('id', body.deck_id).eq('user_id', userId).single()
  if (!deck) return c.json({ error: { code: 'NOT_FOUND', message: 'Deck not found' } }, 404)

  // Generate invite code if requested
  let inviteCode = null
  if (body.generate_link) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    inviteCode = Array.from(bytes).map(b => chars[b % chars.length]).join('')
  }

  const { data, error } = await sb
    .from('deck_shares')
    .insert({
      deck_id: body.deck_id,
      owner_id: userId,
      share_mode: body.share_mode,
      invite_code: inviteCode,
      invite_email: body.invite_email || null,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data }, 201)
})

// POST /v1/shares/accept
app.openapi(acceptShareRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const body = c.req.valid('json')

  const { data: share, error: findError } = await sb
    .from('deck_shares')
    .select('*')
    .eq('invite_code', body.invite_code)
    .eq('status', 'pending')
    .single()

  if (findError || !share) return c.json({ error: { code: 'NOT_FOUND', message: 'Invalid or expired invite code' } }, 404)

  if (share.owner_id === userId) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Cannot accept your own invite' } }, 400)
  }

  let deckId = share.deck_id

  if (share.share_mode === 'subscribe') {
    await sb.from('deck_shares').update({ recipient_id: userId, status: 'active', accepted_at: new Date().toISOString() }).eq('id', share.id)
    await sb.rpc('init_subscriber_progress', { p_user_id: userId, p_deck_id: share.deck_id })
  } else {
    const isReadonly = share.share_mode === 'snapshot'
    const { data: newDeckId, error: rpcError } = await sb.rpc('copy_deck_for_user', {
      p_source_deck_id: share.deck_id, p_recipient_id: userId, p_is_readonly: isReadonly, p_share_mode: share.share_mode,
    })
    if (rpcError) return c.json({ error: { code: 'DB_ERROR', message: rpcError.message } }, 500)
    deckId = newDeckId
    await sb.from('deck_shares').update({ recipient_id: userId, status: 'active', accepted_at: new Date().toISOString(), copied_deck_id: newDeckId }).eq('id', share.id)
  }

  return c.json({ data: { deck_id: deckId } }, 200)
})

// GET /v1/shares
app.openapi(listSharesRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')

  const { data: sent } = await sb.from('deck_shares').select('*').eq('owner_id', userId).order('created_at', { ascending: false })
  const { data: received } = await sb.from('deck_shares').select('*').eq('recipient_id', userId).order('created_at', { ascending: false })

  return c.json({ data: { sent: sent ?? [], received: received ?? [] } }, 200)
})

// DELETE /v1/shares/{shareId}
app.openapi(deleteShareRoute, async (c) => {
  const userId = c.get('userId')
  const sb = c.get('supabase')
  const { shareId } = c.req.valid('param')

  const { data: share } = await sb.from('deck_shares').select('id, owner_id, recipient_id')
    .eq('id', shareId)
    .single()

  if (!share) return c.json({ error: { code: 'NOT_FOUND', message: 'Share not found' } }, 404)

  // Allow owner or recipient to revoke
  if (share.owner_id !== userId && share.recipient_id !== userId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Share not found' } }, 404)
  }

  const { error } = await sb.from('deck_shares').update({ status: 'revoked' }).eq('id', shareId)
  if (error) return c.json({ error: { code: 'DB_ERROR', message: error.message } }, 500)
  return c.json({ data: { deleted: true } }, 200)
})

// ─── OpenAPI Spec + Swagger UI ────────────────────────────────

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    title: 'ReeeeecallStudy API',
    version: '1.0.0',
    description: '플래시카드 학습 앱 REST API — 덱, 카드, 템플릿 관리',
  },
  servers: [
    { url: '/api', description: 'Current server' },
  ],
  security: [{ Bearer: [] }],
})

app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'API Key',
  description: 'API 키를 입력하세요. 예: rc_xxxxx',
})

app.get('/ui', swaggerUI({ url: 'doc' }))

// ─── 404 fallback ─────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: `Route not found: ${c.req.method} ${c.req.path}` } }, 404)
})

// ─── Serve ────────────────────────────────────────────────────

Deno.serve(app.fetch)
