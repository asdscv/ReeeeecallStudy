import { useNavigate } from 'react-router';
import { Brain, Zap, Target, BarChart3, Globe, Smartphone, ArrowRight, CheckCircle2, Star, Users, TrendingUp } from 'lucide-react';

export function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-gray-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-400 rounded-lg flex items-center justify-center">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900">ReeeCall</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-gray-600 hover:text-gray-900 transition-colors">기능</a>
              <a href="#benefits" className="text-gray-600 hover:text-gray-900 transition-colors">장점</a>
              <a href="#stats" className="text-gray-600 hover:text-gray-900 transition-colors">통계</a>
              <button
                onClick={() => navigate('/content')}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                학습 가이드
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/auth/login')}
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors"
              >
                로그인
              </button>
              <button
                onClick={() => navigate('/auth/login')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                시작하기
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-sm font-medium mb-6">
              <Zap className="w-4 h-4" />
              <span>스마트한 학습의 시작</span>
            </div>
            
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight">
              기억의 한계를
              <br />
              <span className="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">
                뛰어넘는 학습
              </span>
            </h1>
            
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto leading-relaxed">
              과학적인 간격 반복(SRS) 알고리즘으로 학습 효율을 극대화하세요.
              <br />
              ReeeCall과 함께라면 더 빠르고 오래 기억할 수 있습니다.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <button
                onClick={() => navigate('/auth/login')}
                className="w-full sm:w-auto px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 text-lg font-semibold shadow-lg shadow-blue-600/30 hover:shadow-xl hover:shadow-blue-600/40 hover:-translate-y-0.5"
              >
                무료로 시작하기
                <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full sm:w-auto px-8 py-4 border-2 border-gray-300 text-gray-700 rounded-xl hover:border-gray-400 transition-colors text-lg font-semibold"
              >
                자세히 알아보기
              </button>
            </div>

            {/* Social Proof */}
            <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <span>10,000+ 사용자</span>
              </div>
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-400 fill-current" />
                <span>4.9/5.0 평점</span>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                <span>평균 학습 효율 200% 향상</span>
              </div>
            </div>
          </div>

          {/* Hero Image Placeholder */}
          <div className="mt-16 relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-3xl"></div>
            <div className="relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl shadow-2xl overflow-hidden border border-gray-700">
              <div className="aspect-video flex items-center justify-center p-8">
                <div className="text-center">
                  <Brain className="w-24 h-24 text-blue-400 mx-auto mb-4" />
                  <p className="text-2xl font-semibold text-white mb-2">ReeeCall Study</p>
                  <p className="text-gray-400">스마트한 플래시카드 학습 플랫폼</p>
                </div>
              </div>
              {/* Decorative bars */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              강력한 기능들
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              학습을 더 효과적으로 만드는 핵심 기능들을 만나보세요
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Brain className="w-8 h-8" />}
              title="스마트 SRS 알고리즘"
              description="과학적으로 검증된 간격 반복 학습으로 장기 기억을 극대화합니다"
              gradient="from-blue-600 to-blue-400"
            />
            <FeatureCard
              icon={<Target className="w-8 h-8" />}
              title="5가지 학습 모드"
              description="SRS, 순차, 랜덤, 순서대로, 일자별 학습 등 다양한 방식 지원"
              gradient="from-purple-600 to-purple-400"
            />
            <FeatureCard
              icon={<BarChart3 className="w-8 h-8" />}
              title="실시간 통계"
              description="학습 진행률, 정답률, 복습 간격 등을 한눈에 확인"
              gradient="from-green-600 to-green-400"
            />
            <FeatureCard
              icon={<Globe className="w-8 h-8" />}
              title="다국어 TTS"
              description="모든 필드에 언어별 음성 합성 기능 제공"
              gradient="from-orange-600 to-orange-400"
            />
            <FeatureCard
              icon={<Zap className="w-8 h-8" />}
              title="키보드 단축키"
              description="Space로 뒤집기, 1-4로 평가 등 빠른 학습 지원"
              gradient="from-pink-600 to-pink-400"
            />
            <FeatureCard
              icon={<Smartphone className="w-8 h-8" />}
              title="반응형 디자인"
              description="PC, 태블릿, 모바일 모든 기기에서 완벽하게 작동"
              gradient="from-indigo-600 to-indigo-400"
            />
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="benefits" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                왜 ReeeCall인가?
              </h2>
              <p className="text-xl text-gray-600 mb-8">
                Anki의 강력함과 현대적인 UI를 결합한 차세대 플래시카드 학습 도구
              </p>
              
              <div className="space-y-4">
                <BenefitItem text="과학적으로 검증된 학습 알고리즘" />
                <BenefitItem text="직관적이고 깔끔한 사용자 인터페이스" />
                <BenefitItem text="템플릿 시스템으로 쉬운 덱 관리" />
                <BenefitItem text="CSV/JSON 일괄 업로드 지원" />
                <BenefitItem text="태그 기반 검색 및 필터링" />
                <BenefitItem text="상세한 학습 통계 및 분석" />
              </div>

              <div className="mt-8">
                <button
                  onClick={() => navigate('/auth/login')}
                  className="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 text-lg font-semibold shadow-lg shadow-blue-600/30"
                >
                  지금 시작하기
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-purple-600/20 blur-3xl"></div>
              <div className="relative bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 shadow-2xl border border-gray-700">
                <div className="space-y-6">
                  <StatCard label="학습 효율" value="200%" trend="+150%" />
                  <StatCard label="평균 복습 간격" value="15일" trend="+8일" />
                  <StatCard label="정답률" value="87%" trend="+23%" />
                  <StatCard label="일일 학습 카드" value="45장" trend="+30장" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section id="stats" className="py-20 bg-gradient-to-br from-blue-600 to-blue-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              숫자로 보는 ReeeCall
            </h2>
            <p className="text-xl text-blue-100">
              전 세계 학습자들이 선택한 플랫폼
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-5xl font-bold mb-2">10K+</div>
              <div className="text-blue-100">활성 사용자</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold mb-2">1M+</div>
              <div className="text-blue-100">생성된 카드</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold mb-2">5M+</div>
              <div className="text-blue-100">학습 세션</div>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold mb-2">4.9</div>
              <div className="text-blue-100">평균 평점</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            오늘부터 더 스마트하게 학습하세요
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            무료로 시작하고, 언제든지 업그레이드하세요
          </p>
          <button
            onClick={() => navigate('/auth/login')}
            className="px-12 py-5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 text-xl font-semibold mx-auto shadow-xl shadow-blue-600/30 hover:shadow-2xl hover:shadow-blue-600/40 hover:-translate-y-0.5"
          >
            무료로 시작하기
            <ArrowRight className="w-6 h-6" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-400 rounded-lg flex items-center justify-center">
                  <Brain className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">ReeeCall</span>
              </div>
              <p className="text-sm">
                스마트한 플래시카드 학습 플랫폼
              </p>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">제품</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">기능</a></li>
                <li><a href="#benefits" className="hover:text-white transition-colors">장점</a></li>
                <li><a href="#stats" className="hover:text-white transition-colors">통계</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">회사</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition-colors">소개</a></li>
                <li><a href="#" className="hover:text-white transition-colors">블로그</a></li>
                <li><a href="#" className="hover:text-white transition-colors">채용</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">지원</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition-colors">도움말</a></li>
                <li><a href="#" className="hover:text-white transition-colors">문의하기</a></li>
                <li><a href="#" className="hover:text-white transition-colors">개인정보처리방침</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 pt-8 text-sm text-center">
            <p>&copy; 2026 ReeeCall. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  gradient,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  gradient: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 border border-gray-100">
      <div className={`w-16 h-16 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center text-white mb-6`}>
        {icon}
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
      <p className="text-gray-600 leading-relaxed">{description}</p>
    </div>
  );
}

function BenefitItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle2 className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
      <span className="text-gray-700 text-lg">{text}</span>
    </div>
  );
}

function StatCard({ label, value, trend }: { label: string; value: string; trend: string }) {
  return (
    <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-sm">{label}</span>
        <span className="text-green-400 text-sm font-medium">{trend}</span>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
    </div>
  );
}