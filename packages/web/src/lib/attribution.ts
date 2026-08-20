import { supabase } from './supabase'

/**
 * 첫 접점 광고 귀속.
 *
 * 광고를 클릭한 사람이 그 자리에서 가입하는 일은 드물다. 며칠 뒤 다시 와서 가입한다.
 * 그 사이를 살아남지 못하면 "이 가입은 어느 광고가 만들었나" 에 영원히 답할 수 없다.
 *
 * 지금까지는 UTM 을 읽는 순간 RPC 인자로 한 번 쓰고 버렸다. 그래서 page_views
 * 14,440행의 utm_source 가 전부 NULL 이다.
 *
 * 규칙 두 가지:
 *  1. **첫 접점이 이긴다.** 광고로 처음 들어온 사람이 나중에 검색으로 재방문해 가입하면
 *     그 가입은 광고가 만든 것이다. 그래서 write-once — 이미 저장돼 있으면 덮지 않는다.
 *  2. **localStorage 다.** sessionStorage 는 탭을 닫으면 사라져서 '며칠 뒤 가입'을 못 잇는다.
 */
const KEY = 'reeeeecall-attribution'

/** 광고 파라미터는 짧다. 길면 누가 URL 에 장난친 것이므로 자른다. */
const MAX_VALUE = 200

export interface Attribution {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  /** 메타 광고 클릭 ID. 전환 API 로 되돌려줄 때 필요하다. */
  fbclid?: string
  gclid?: string
  referrer?: string
  referrer_domain?: string
  landing_path?: string
  first_seen_at?: string
}

const PARAM_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid',
] as const

function clip(v: string | null): string | undefined {
  if (!v) return undefined
  const t = v.trim().slice(0, MAX_VALUE)
  return t === '' ? undefined : t
}

/** 지금 URL 에서 광고 파라미터를 읽는다. 아무것도 없으면 null. */
export function readAttributionFromUrl(search: string, referrer: string, path: string): Attribution | null {
  const params = new URLSearchParams(search)
  const out: Attribution = {}
  let hasAny = false
  for (const key of PARAM_KEYS) {
    const v = clip(params.get(key))
    if (v) {
      out[key] = v
      hasAny = true
    }
  }
  // 광고 파라미터가 하나도 없으면 기록하지 않는다. 직접 들어온 방문까지 첫 접점으로
  // 잡아 두면, 나중에 진짜 광고 클릭이 와도 write-once 규칙에 막혀 버린다.
  if (!hasAny) return null

  const ref = clip(referrer)
  if (ref) {
    out.referrer = ref
    try {
      out.referrer_domain = new URL(ref).hostname
    } catch {
      /* 참조 URL 이 깨져 있으면 도메인은 그냥 비운다 */
    }
  }
  out.landing_path = clip(path) ?? '/'
  out.first_seen_at = new Date().toISOString()
  return out
}

/** 저장된 첫 접점. 없으면 null. */
export function getStoredAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Attribution) : null
  } catch {
    return null
  }
}

/**
 * 현재 URL 에 광고 파라미터가 있으면 첫 접점으로 붙든다. 이미 있으면 손대지 않는다.
 * 로그인 여부와 무관하게 매 로드마다 호출해도 안전하다.
 */
export function captureAttribution(): void {
  try {
    if (localStorage.getItem(KEY)) return
    const found = readAttributionFromUrl(
      window.location.search,
      document.referrer,
      window.location.pathname,
    )
    if (!found) return
    localStorage.setItem(KEY, JSON.stringify(found))
  } catch {
    /* 사파리 프라이빗 모드 등에서 localStorage 가 막혀도 앱은 계속 돌아야 한다 */
  }
}

/**
 * 로그인한 사용자의 프로필에 첫 접점을 한 번만 새긴다.
 * 서버 쪽 set_my_attribution 도 write-once 라 두 번 불러도 안전하다.
 */
export async function attachAttributionToProfile(): Promise<void> {
  const stored = getStoredAttribution()
  if (!stored) return
  try {
    await supabase.rpc('set_my_attribution', { p_attribution: stored })
  } catch {
    /* 귀속 기록 실패가 로그인 흐름을 막으면 안 된다 */
  }
}
