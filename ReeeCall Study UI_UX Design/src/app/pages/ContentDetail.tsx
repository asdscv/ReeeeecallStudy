import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Brain, Zap, Target, TrendingUp } from 'lucide-react';

interface ContentDetailData {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  readTime: string;
}

const contentData: Record<string, ContentDetailData> = {
  '1': {
    id: '1',
    title: 'SRS 알고리즘의 모든 것',
    subtitle: '과학이 증명한 학습 혁명',
    date: '2026.02.15',
    readTime: '5분',
  },
};

export function ContentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const content = id ? contentData[id] : null;

  if (!content) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-4">페이지를 찾을 수 없습니다</h2>
          <button
            onClick={() => navigate('/content')}
            className="text-blue-600 hover:text-blue-500 transition-colors"
          >
            목록으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Minimal Header */}
      <header className="fixed top-0 w-full bg-white/70 backdrop-blur-2xl z-50 border-b border-gray-100">
        <div className="max-w-[900px] mx-auto px-8">
          <div className="h-14 flex items-center">
            <button
              onClick={() => navigate('/content')}
              className="text-gray-400 hover:text-gray-900 transition-colors -ml-2 p-2"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <article className="pt-32 pb-20 px-8">
        <div className="max-w-[900px] mx-auto">
          {/* Title Section */}
          <header className="mb-20">
            <h1 className="text-6xl md:text-7xl font-bold text-gray-900 mb-6 leading-[1.05] tracking-tight">
              {content.title}
            </h1>
            
            <p className="text-2xl text-gray-500 mb-10">
              {content.subtitle}
            </p>

            <div className="flex items-center gap-3 text-sm text-gray-400">
              <span>{content.date}</span>
              <span>·</span>
              <span>{content.readTime}</span>
            </div>
          </header>

          {/* Intro Paragraph */}
          <div className="mb-20">
            <p className="text-2xl text-gray-700 leading-relaxed">
              간격 반복 시스템(Spaced Repetition System)은 기억의 망각 곡선을 극복하기 위해 설계된 과학적인 학습 방법입니다. 단순히 반복하는 것이 아니라, 뇌가 정보를 잊어버리기 직전에 복습함으로써 장기 기억으로 효과적으로 전환시킵니다.
            </p>
          </div>

          {/* Quote Block */}
          <div className="mb-20 py-12 border-y border-gray-200">
            <blockquote className="text-3xl font-medium text-gray-900 italic text-center">
              "학습 후 1일이 지나면 약 50%를 잊어버린다"
            </blockquote>
            <p className="text-center text-gray-500 mt-4">Hermann Ebbinghaus, 1885</p>
          </div>

          {/* Main Content */}
          <div className="space-y-8 mb-20">
            <p className="text-xl text-gray-700 leading-relaxed">
              독일의 심리학자 헤르만 에빙하우스(Hermann Ebbinghaus)는 1885년 연구를 통해 인간의 기억이 시간이 지남에 따라 급격히 감소한다는 것을 발견했습니다. 그의 연구에 따르면, 학습 후 1일이 지나면 약 50%를 잊어버리고, 1주일 후에는 70%, 1개월 후에는 80%를 잊어버립니다.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-8 mb-20 py-16 bg-gray-50 rounded-3xl px-12">
            <div className="text-center">
              <div className="text-5xl font-bold text-blue-600 mb-2">50%</div>
              <div className="text-sm text-gray-600">1일 후 망각</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-blue-600 mb-2">70%</div>
              <div className="text-sm text-gray-600">1주일 후 망각</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-blue-600 mb-2">80%</div>
              <div className="text-sm text-gray-600">1개월 후 망각</div>
            </div>
          </div>

          {/* Section Divider */}
          <div className="mb-20">
            <div className="w-16 h-1 bg-blue-600 mb-12" />
            <h2 className="text-5xl font-bold text-gray-900 mb-8 tracking-tight">
              SRS의 해결책
            </h2>
            <p className="text-xl text-gray-700 leading-relaxed mb-8">
              SRS는 이 망각 곡선을 극복하기 위해 적절한 시점에 복습을 제공합니다. 첫 복습은 학습 후 1일, 두 번째는 3일 후, 세 번째는 1주일 후, 이런 식으로 간격이 점점 늘어나면서 정보를 장기 기억으로 전환시킵니다.
            </p>
          </div>

          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
            <div className="p-8 bg-blue-50 rounded-2xl">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">개인 맞춤형</h3>
              <p className="text-gray-600 leading-relaxed">
                각 카드의 난이도에 따라 다른 간격 적용
              </p>
            </div>
            <div className="p-8 bg-purple-50 rounded-2xl">
              <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">효율성</h3>
              <p className="text-gray-600 leading-relaxed">
                잊어버릴 찰나에 정확히 복습
              </p>
            </div>
            <div className="p-8 bg-green-50 rounded-2xl">
              <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center mb-4">
                <Target className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">자동화</h3>
              <p className="text-gray-600 leading-relaxed">
                수동 일정 관리 불필요
              </p>
            </div>
          </div>

          {/* More Content */}
          <div className="mb-20">
            <div className="w-16 h-1 bg-blue-600 mb-12" />
            <h2 className="text-5xl font-bold text-gray-900 mb-8 tracking-tight">
              실전 활용 팁
            </h2>
            
            <div className="space-y-12">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">01. 카드는 간결하게</h3>
                <p className="text-xl text-gray-700 leading-relaxed">
                  한 카드에 하나의 개념만 담으세요. 너무 많은 정보는 학습 효율을 떨어뜨립니다.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">02. 매일 조금씩</h3>
                <p className="text-xl text-gray-700 leading-relaxed">
                  하루 15-30분의 꾸준한 학습이 주말에 몰아서 하는 것보다 훨씬 효과적입니다. 뇌는 짧은 시간 동안 집중하는 것을 선호하며, 규칙적인 학습 습관이 장기적으로 더 큰 성과를 만들어냅니다.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">03. 능동적으로 회상</h3>
                <p className="text-xl text-gray-700 leading-relaxed">
                  답을 보기 전에 스스로 답을 떠올리는 시간을 가지세요. 이 과정이 기억을 강화합니다.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">04. 정직하게 평가</h3>
                <p className="text-xl text-gray-700 leading-relaxed">
                  너무 쉽거나 어려운 평가는 알고리즘의 정확도를 떨어뜨립니다. 정확한 평가가 정확한 복습 주기를 만듭니다.
                </p>
              </div>
            </div>
          </div>

          {/* Highlight Box */}
          <div className="mb-20 p-12 bg-gradient-to-br from-blue-600 to-blue-500 rounded-3xl text-white">
            <div className="flex items-center gap-3 mb-6">
              <TrendingUp className="w-8 h-8" />
              <h3 className="text-3xl font-bold">2배 이상의 효과</h3>
            </div>
            <p className="text-xl text-blue-50 leading-relaxed">
              Cepeda 등의 2006년 연구에 따르면 간격 반복이 단순 반복보다 2배 이상 효과적이며, Kornell과 Bjork의 2008년 연구는 간격을 두고 학습하면 장기 보유율이 50% 향상된다고 밝혔습니다.
            </p>
          </div>

          {/* Final Paragraph */}
          <div className="mb-20">
            <p className="text-2xl text-gray-700 leading-relaxed">
              SRS는 단순한 학습 도구가 아닙니다. 뇌과학과 인지심리학을 기반으로 한 과학적 학습 시스템입니다. ReeeCall과 함께 더 효율적으로, 더 오래 기억하세요.
            </p>
          </div>
        </div>
      </article>

      {/* CTA */}
      <section className="py-24 px-8 bg-black text-white">
        <div className="max-w-[900px] mx-auto text-center">
          <h2 className="text-5xl font-bold mb-8 tracking-tight">
            ReeeCall로 시작하기
          </h2>
          <p className="text-xl text-gray-400 mb-12">
            지금 바로 효율적인 학습을 경험하세요
          </p>
          <button
            onClick={() => navigate('/auth/login')}
            className="inline-flex items-center justify-center px-8 py-4 bg-white text-black text-base font-semibold rounded-full hover:bg-gray-100 transition-colors"
          >
            무료로 시작하기
          </button>
        </div>
      </section>
    </div>
  );
}
