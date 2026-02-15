import { useNavigate } from 'react-router-dom'
import { ArrowRight, Brain, Layers, BarChart3, Share2, Globe, Smartphone, Zap, BookOpen, CheckCircle2 } from 'lucide-react'

const FEATURES = [
  {
    icon: Brain,
    color: 'bg-blue-100 text-blue-600',
    title: '스마트 SRS 알고리즘',
    desc: '과학적으로 검증된 간격 반복 학습으로 장기 기억을 극대화합니다. Again/Hard/Good/Easy 4단계 평가로 자동 복습 시기 조절.',
  },
  {
    icon: Layers,
    color: 'bg-purple-100 text-purple-600',
    title: '5가지 학습 모드',
    desc: 'SRS, 랜덤, 순차, 순차복습, 날짜별 등 상황에 맞는 학습 모드를 지원합니다.',
  },
  {
    icon: BarChart3,
    color: 'bg-green-100 text-green-600',
    title: '실시간 통계 & 대시보드',
    desc: '학습 잔디, 복습 예측, 일별 학습량 등 상세 통계로 진도를 한눈에 파악하세요.',
  },
  {
    icon: Share2,
    color: 'bg-orange-100 text-orange-600',
    title: '덱 공유 & 마켓플레이스',
    desc: '복사·구독·스냅샷 3가지 모드로 덱을 공유하고, 마켓에서 다른 사용자의 덱을 가져오세요.',
  },
  {
    icon: Globe,
    color: 'bg-pink-100 text-pink-600',
    title: '다국어 TTS',
    desc: '필드별 언어 설정으로 한국어, 영어, 일본어, 중국어 등 음성 자동 읽기를 지원합니다.',
  },
  {
    icon: Smartphone,
    color: 'bg-indigo-100 text-indigo-600',
    title: '반응형 디자인',
    desc: 'PC, 태블릿, 모바일 어디서든 완벽하게 작동합니다. 스와이프 학습으로 이동 중에도 학습 가능.',
  },
]

const BENEFITS = [
  '과학적으로 검증된 SRS 학습 알고리즘',
  '직관적이고 깔끔한 사용자 인터페이스',
  '커스텀 템플릿으로 유연한 카드 구조',
  'CSV/JSON 가져오기·내보내기 지원',
  '태그 기반 검색 및 필터링',
  '덱 공유 & 커뮤니티 마켓플레이스',
  '상세한 학습 통계 및 분석',
  'API 키로 외부 연동 가능',
]

function LandingNav() {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-center py-4">
        <div className="flex items-center gap-3.5">
          <img src="/favicon.png" alt="" className="w-14 h-14 sm:w-16 sm:h-16" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-14 sm:h-16 hidden sm:block" />
          <span className="font-extrabold text-gray-900 sm:hidden text-3xl tracking-tight">ReeeeecallStudy</span>
        </div>
      </div>
    </header>
  )
}

export function LandingPage() {
  const navigate = useNavigate()
  const goLogin = () => navigate('/auth/login')

  return (
    <div className="min-h-screen bg-white">
      <LandingNav />

      {/* ─── Hero ────────────────────────────── */}
      <section className="py-16 sm:py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-600 text-sm font-medium rounded-full mb-6">
            <Zap className="w-4 h-4" />
            스마트한 학습의 시작
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
            기억의 한계를
            <br />
            <span className="text-blue-600">뛰어넘는 학습</span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            과학적인 간격 반복(SRS) 알고리즘으로 학습 효율을 극대화하세요.
            <br className="hidden sm:block" />
            ReeeeecallStudy와 함께라면 더 빠르고 오래 기억할 수 있습니다.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button
              onClick={goLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-blue-600 text-white text-base font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              무료로 시작하기 <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="w-full sm:w-auto px-8 py-3.5 border border-gray-300 text-gray-700 text-base font-medium rounded-xl hover:bg-gray-50 transition cursor-pointer"
            >
              자세히 알아보기
            </button>
          </div>
        </div>
      </section>

      {/* ─── App Preview ────────────────────── */}
      <section className="px-4 pb-16 sm:pb-24">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-900 rounded-2xl p-8 sm:p-10 text-center">
            <img src="/favicon.png" alt="" className="w-32 h-32 sm:w-40 sm:h-40 mx-auto mb-5 opacity-90" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-20 sm:h-28 mx-auto mb-2 brightness-0 invert" />
            <p className="text-gray-400 text-lg sm:text-2xl">스마트한 플래시카드 학습 플랫폼</p>
          </div>
        </div>
      </section>

      {/* ─── Features ──────────────────────── */}
      <section id="features" className="py-16 sm:py-24 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">강력한 기능들</h2>
            <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
              효율적인 학습을 위한 모든 도구를 한곳에서 제공합니다
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${f.color}`}>
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Benefits ──────────────────────── */}
      <section id="benefits" className="py-16 sm:py-24 px-4">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              왜 ReeeeecallStudy인가?
            </h2>
            <p className="text-gray-500 text-base sm:text-lg mb-8">
              간격 반복 학습의 강력함과 현대적인 UI를 결합한 차세대 플래시카드 학습 도구
            </p>

            <ul className="space-y-3">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <span className="text-gray-700 text-sm sm:text-base">{b}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={goLogin}
              className="mt-8 flex items-center gap-2 px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              지금 시작하기 <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-gray-900 rounded-2xl p-6 sm:p-8 space-y-4">
            {[
              { label: '학습 효율', value: '200%', change: '+150%' },
              { label: '평균 복습 간격', value: '15일', change: '+8일' },
              { label: '정답률', value: '87%', change: '+23%' },
              { label: '일일 학습 카드', value: '45장', change: '+30장' },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center justify-between bg-gray-800 rounded-xl p-4">
                <div>
                  <p className="text-xs text-gray-400">{stat.label}</p>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                </div>
                <span className="text-sm font-semibold text-green-400">{stat.change}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ──────────────────── */}
      <section className="py-16 sm:py-24 px-4 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-12">간단한 3단계로 시작</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8">
            {[
              { step: '1', icon: BookOpen, title: '덱 만들기', desc: '주제별로 카드를 묶는 덱을 만들고,\n카드를 추가하세요.' },
              { step: '2', icon: Brain, title: '학습하기', desc: 'SRS가 최적의 타이밍에\n복습 카드를 제시합니다.' },
              { step: '3', icon: BarChart3, title: '성장 확인', desc: '대시보드에서 학습 통계와\n성장 추이를 확인하세요.' },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-blue-600 text-white text-2xl font-bold flex items-center justify-center mb-5 shadow-lg shadow-blue-600/25">
                  {s.step}
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line max-w-[200px]">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ───────────────────────────── */}
      <section id="cta" className="py-16 sm:py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            오늘부터 더 스마트하게 학습하세요
          </h2>
          <p className="text-gray-500 text-base sm:text-lg mb-8">
            무료로 시작하세요. 이메일과 비밀번호로 간편하게 가입합니다.
          </p>
          <button
            onClick={goLogin}
            className="inline-flex items-center gap-2 px-10 py-4 bg-blue-600 text-white text-lg font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/25 cursor-pointer"
          >
            무료로 시작하기 <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* ─── Footer ────────────────────────── */}
      <footer className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/favicon.png" alt="" className="w-7 h-7" />
              <span className="font-bold text-gray-900">ReeeeecallStudy</span>
            </div>
            <p className="text-sm text-gray-400">
              &copy; 2026 ReeeeecallStudy. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* ─── Floating CTA ─────────────────────── */}
      <button
        onClick={goLogin}
        className="group fixed bottom-12 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-16 flex items-center gap-3 px-6 py-4 bg-transparent cursor-pointer z-50 whitespace-nowrap touch-manipulation"
      >
        <div className="relative">
          <img src="/favicon.png" alt="" className="w-14 h-14 relative z-10 transition-transform duration-300 group-hover:scale-120 group-hover:rotate-12 active:scale-120 active:rotate-12" />
          <div className="absolute inset-0 bg-blue-500/0 rounded-full blur-xl transition-all duration-300 group-hover:bg-blue-500/40 group-hover:scale-150 group-active:bg-blue-500/40 group-active:scale-150" />
        </div>
        <div className="relative">
          <span className="text-2xl font-bold text-gray-900 relative z-10 transition-all duration-300 group-hover:text-blue-600 group-hover:tracking-wider group-active:text-blue-600 group-active:tracking-wider">시작하기</span>
          <div className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-500 rounded-full transition-all duration-300 group-hover:w-full group-hover:shadow-[0_0_10px_rgba(59,130,246,0.6)] group-active:w-full group-active:shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
        </div>
      </button>
    </div>
  )
}
