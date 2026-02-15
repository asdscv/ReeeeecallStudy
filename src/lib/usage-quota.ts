import type { TierConfig, ResourceType } from './tier-config'

const DAILY_RESOURCES: ResourceType[] = [
  'api_requests_daily',
  'study_sessions_daily',
  'file_uploads_daily',
]

const STORAGE_KEY = 'reeeeecall_usage_quota'

export interface UsageData {
  counters: Partial<Record<ResourceType, number>>
  lastResetDate: string
}

export interface UsageStore {
  load(): UsageData
  save(data: UsageData): void
  clear(): void
}

export interface QuotaCheckResult {
  allowed: boolean
  current: number
  limit: number
  message?: string
}

export interface UsageQuota {
  checkQuota(resource: ResourceType, incrementBy?: number): QuotaCheckResult
  recordUsage(resource: ResourceType, amount?: number): void
  setUsage(resource: ResourceType, value: number): void
  resetDailyIfNeeded(): void
  resetAll(): void
}

export interface UsageQuotaOptions {
  now?: () => number
}

export function createMemoryStore(): UsageStore {
  let data: UsageData = { counters: {}, lastResetDate: '' }
  return {
    load: () => data,
    save: (d) => { data = d },
    clear: () => { data = { counters: {}, lastResetDate: '' } },
  }
}

export function createLocalStorageStore(): UsageStore {
  return {
    load(): UsageData {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return JSON.parse(raw)
      } catch {
        // ignore parse errors
      }
      return { counters: {}, lastResetDate: '' }
    },
    save(data: UsageData): void {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
    clear(): void {
      localStorage.removeItem(STORAGE_KEY)
    },
  }
}

function getDateString(ms: number): string {
  return new Date(ms).toISOString().split('T')[0]
}

const RESOURCE_LABELS: Record<ResourceType, string> = {
  api_requests_daily: 'API 요청 (일일)',
  storage_bytes: '저장 공간',
  cards_total: '카드 수',
  decks_total: '덱 수',
  templates_total: '템플릿 수',
  study_sessions_daily: '학습 세션 (일일)',
  file_uploads_daily: '파일 업로드 (일일)',
}

export function createUsageQuota(
  tierConfig: TierConfig,
  store: UsageStore,
  options?: UsageQuotaOptions,
): UsageQuota {
  const now = options?.now ?? Date.now

  function getData(): UsageData {
    return store.load()
  }

  function saveData(data: UsageData): void {
    store.save(data)
  }

  return {
    checkQuota(resource: ResourceType, incrementBy = 1): QuotaCheckResult {
      const data = getData()
      const current = data.counters[resource] ?? 0
      const limit = tierConfig.quotas[resource]

      if (current + incrementBy > limit) {
        return {
          allowed: false,
          current,
          limit,
          message: `${RESOURCE_LABELS[resource]} 한도에 도달했습니다 (${current}/${limit})`,
        }
      }

      return { allowed: true, current, limit }
    },

    recordUsage(resource: ResourceType, amount = 1): void {
      const data = getData()
      const current = data.counters[resource] ?? 0
      data.counters[resource] = current + amount

      if (!data.lastResetDate) {
        data.lastResetDate = getDateString(now())
      }

      saveData(data)
    },

    setUsage(resource: ResourceType, value: number): void {
      const data = getData()
      data.counters[resource] = value

      if (!data.lastResetDate) {
        data.lastResetDate = getDateString(now())
      }

      saveData(data)
    },

    resetDailyIfNeeded(): void {
      const data = getData()
      const today = getDateString(now())

      if (data.lastResetDate && data.lastResetDate !== today) {
        for (const resource of DAILY_RESOURCES) {
          data.counters[resource] = 0
        }
        data.lastResetDate = today
        saveData(data)
      }
    },

    resetAll(): void {
      store.clear()
    },
  }
}
