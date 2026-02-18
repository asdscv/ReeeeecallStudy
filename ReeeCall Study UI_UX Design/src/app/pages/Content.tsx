import { useState } from 'react';
import { useNavigate } from 'react-router';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { Brain, ArrowLeft } from 'lucide-react';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';

interface ContentItem {
  id: string;
  title: string;
  image: string;
  height: number;
}

const sampleContent: ContentItem[] = [
  {
    id: '1',
    title: '효율적인 학습법: SRS 알고리즘의 모든 것',
    image: 'https://images.unsplash.com/photo-1697981027675-3770d1b8ee6d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhYnN0cmFjdCUyMGdlb21ldHJpYyUyMHNoYXBlcyUyMG1pbmltYWx8ZW58MXx8fHwxNzcxMzI0NDMxfDA&ixlib=rb-4.1.0&q=80&w=1080',
    height: 400,
  },
  {
    id: '2',
    title: '언어 학습에 플래시카드를 활용하는 방법',
    image: 'https://images.unsplash.com/photo-1760434773841-7eef8a7af7c7?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHwzZCUyMGlzb21ldHJpYyUyMGlsbHVzdHJhdGlvbiUyMGNvbmNlcHR8ZW58MXx8fHwxNzcxMzQwMDc5fDA&ixlib=rb-4.1.0&q=80&w=1080',
    height: 300,
  },
  {
    id: '3',
    title: '의학 시험 준비를 위한 학습 전략',
    image: 'https://images.unsplash.com/photo-1566419834777-c0e4c5e7870f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBhcmNoaXRlY3R1cmUlMjBtaW5pbWFsJTIwZGVzaWdufGVufDF8fHx8MTc3MTM0MDA3OXww&ixlib=rb-4.1.0&q=80&w=1080',
    height: 350,
  },
  {
    id: '4',
    title: '데이터 구조 마스터하기',
    image: 'https://images.unsplash.com/photo-1763615445790-64c644be359b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwYXN0ZWwlMjBncmFkaWVudCUyMGFic3RyYWN0JTIwYXJ0fGVufDF8fHx8MTc3MTM0MDA3OXww&ixlib=rb-4.1.0&q=80&w=1080',
    height: 280,
  },
  {
    id: '5',
    title: '매일 10분, 꾸준한 학습의 힘',
    image: 'https://images.unsplash.com/photo-1657757996603-acec063f1d9b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3b3Jrc3BhY2UlMjBkZXNrJTIwbWluaW1hbCUyMGFlc3RoZXRpY3xlbnwxfHx8fDE3NzEzNDAwODB8MA&ixlib=rb-4.1.0&q=80&w=1080',
    height: 420,
  },
  {
    id: '6',
    title: '기억력을 극대화하는 5가지 비법',
    image: 'https://images.unsplash.com/photo-1762279389053-d5a30239ae45?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0ZWNobm9sb2d5JTIwZGlnaXRhbCUyMGFic3RyYWN0JTIwY29uY2VwdHxlbnwxfHx8fDE3NzEzNDAwODB8MA&ixlib=rb-4.1.0&q=80&w=1080',
    height: 360,
  },
];

export function Content() {
  const navigate = useNavigate();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-gray-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/')}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-400 rounded-lg flex items-center justify-center">
                  <Brain className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-gray-900">ReeeCall</span>
              </div>
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
      <section className="pt-32 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            학습 인사이트
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            더 나은 학습을 위한 팁과 영감
          </p>
        </div>
      </section>

      {/* Masonry Grid */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <ResponsiveMasonry
            columnsCountBreakPoints={{ 350: 1, 750: 2, 900: 3 }}
          >
            <Masonry gutter="20px">
              {sampleContent.map((item) => (
                <div
                  key={item.id}
                  onClick={() => navigate(`/content/${item.id}`)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="relative rounded-2xl overflow-hidden cursor-pointer group"
                  style={{
                    height: `${item.height}px`,
                    transform: hoveredId === item.id ? 'scale(0.98)' : 'scale(1)',
                    transition: 'transform 0.3s ease',
                  }}
                >
                  {/* Image */}
                  <ImageWithFallback
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />
                  
                  {/* Title */}
                  <div className="absolute inset-0 flex items-end p-8">
                    <h3 className="text-white text-2xl md:text-3xl font-bold leading-tight">
                      {item.title}
                    </h3>
                  </div>
                </div>
              ))}
            </Masonry>
          </ResponsiveMasonry>
        </div>
      </section>
    </div>
  );
}
