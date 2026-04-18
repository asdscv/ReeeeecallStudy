/**
 * Prefetch Service — 스플래시 화면 동안 핵심 데이터를 병렬 로드.
 *
 * 아키텍처:
 *   1) RootNavigator에서 user 확인 후 prefetch.run(userId) 호출
 *   2) 등록된 모든 태스크를 Promise.allSettled로 병렬 실행
 *   3) 진행률(0~1)을 구독자(LoadingScreen)에 실시간 통보
 *   4) 완료 또는 타임아웃 시 ready 상태 전환
 *
 * 확장 방법:
 *   prefetch.register('taskName', async (userId) => { ... })
 *   → 새 데이터 소스 추가 시 이 한 줄이면 끝. 화면 코드 수정 불필요.
 *
 * Store 연동:
 *   각 태스크는 Zustand store의 fetch 메서드를 직접 호출.
 *   Store에 데이터가 채워지면 화면은 useStore 훅으로 자동 반영.
 */

type PrefetchTask = {
  name: string
  fn: (userId: string) => Promise<void>
}

type PrefetchStatus = 'idle' | 'loading' | 'ready' | 'error'

type PrefetchState = {
  status: PrefetchStatus
  progress: number // 0–1
  completedTasks: string[]
  failedTasks: string[]
}

type Listener = (state: PrefetchState) => void

class PrefetchService {
  private tasks: PrefetchTask[] = []
  private state: PrefetchState = {
    status: 'idle',
    progress: 0,
    completedTasks: [],
    failedTasks: [],
  }
  private listeners = new Set<Listener>()

  /**
   * 프리로드 태스크 등록.
   * 앱 초기화 시 한 번 호출. 순서 무관 (병렬 실행).
   */
  register(name: string, fn: (userId: string) => Promise<void>): this {
    this.tasks.push({ name, fn })
    return this
  }

  /** 현재 상태 조회 */
  getState(): PrefetchState {
    return { ...this.state }
  }

  /** 상태 변경 구독 (React useSyncExternalStore 호환) */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 모든 등록 태스크를 병렬 실행.
   * 개별 태스크 실패는 전체를 중단하지 않음 (Promise.allSettled).
   */
  async run(userId: string): Promise<void> {
    if (this.state.status === 'loading') return // 중복 호출 방지

    this.setState({
      status: 'loading',
      progress: 0,
      completedTasks: [],
      failedTasks: [],
    })

    const total = this.tasks.length
    if (total === 0) {
      this.setState({ status: 'ready', progress: 1 })
      return
    }

    let completed = 0

    await Promise.allSettled(
      this.tasks.map(async (task) => {
        try {
          await task.fn(userId)
          this.state.completedTasks.push(task.name)
        } catch (e) {
          this.state.failedTasks.push(task.name)
          if (__DEV__) console.warn(`[Prefetch] ${task.name} failed:`, e)
        } finally {
          completed++
          this.setState({ progress: completed / total })
        }
      }),
    )

    this.setState({ status: 'ready', progress: 1 })
  }

  /** 상태 리셋 (로그아웃 시) */
  reset(): void {
    this.setState({
      status: 'idle',
      progress: 0,
      completedTasks: [],
      failedTasks: [],
    })
  }

  private setState(partial: Partial<PrefetchState>): void {
    this.state = { ...this.state, ...partial }
    const snapshot = { ...this.state }
    this.listeners.forEach((fn) => fn(snapshot))
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Singleton + 태스크 등록
// 새 프리로드 대상 추가 시 여기에 .register() 한 줄 추가.
// ─────────────────────────────────────────────────────────────────────────
import { Appearance } from 'react-native'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { getMobileSupabase } from '../adapters'

export const prefetch = new PrefetchService()
  .register('decks', async () => {
    await useDeckStore.getState().fetchDecks()
  })
  .register('stats', async (userId) => {
    await useDeckStore.getState().fetchStats(userId)
  })
  .register('templates', async () => {
    await useDeckStore.getState().fetchTemplates()
  })
  .register('profile', async (userId) => {
    const supabase = getMobileSupabase()
    const { data } = await supabase
      .from('profiles')
      .select('theme, tts_enabled, tts_speed, tts_provider, answer_mode, answer_timing, display_name, daily_new_limit, daily_study_goal')
      .eq('id', userId)
      .single()
    if (data) {
      profileCache.data = data
      profileCache.fetchedAt = Date.now()

      // 테마 즉시 적용 — 스플래시 화면 중에 실행되어 메인 화면 진입 전 반영.
      // React useEffect보다 선행하므로 첫 렌더부터 올바른 테마 적용.
      const theme = data.theme as string | undefined
      if (theme === 'system') {
        Appearance.setColorScheme(null as 'light' | 'dark' | null)
      } else if (theme === 'light' || theme === 'dark') {
        Appearance.setColorScheme(theme)
      }
    }
  })

/** 프로필 캐시 — SettingsScreen 등에서 참조 */
export const profileCache: { data: Record<string, unknown> | null; fetchedAt: number | null } = {
  data: null,
  fetchedAt: null,
}
