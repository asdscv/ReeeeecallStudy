import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus, FileText, Edit2, Trash2 } from 'lucide-react';
import { getTemplates, createTemplate as createTemplateStorage, deleteTemplate } from '../lib/storage';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';

interface Template {
  id: string;
  name: string;
  fields: any[];
  frontLayout: any[];
  backLayout: any[];
  createdAt: string;
  updatedAt: string;
}

interface Deck {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  function fetchData() {
    try {
      const templatesData = getTemplates();
      setTemplates(templatesData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleCreateTemplate(templateData: Partial<Template>) {
    try {
      const newTemplate = createTemplateStorage(templateData);
      setTemplates([...templates, newTemplate]);
      setShowCreateModal(false);
      toast.success('템플릿이 생성되었습니다!');
    } catch (error) {
      console.error('Error creating template:', error);
      toast.error('템플릿 생성에 실패했습니다.');
    }
  }

  function handleDeleteTemplate(id: string) {
    if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;

    try {
      deleteTemplate(id);
      setTemplates(templates.filter((t) => t.id !== id));
      toast.success('템플릿이 삭제되었습니다.');
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('템플릿 삭제에 실패했습니다.');
    }
  }

  if (loading) {
    return <div className="text-gray-500">로딩 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">템플릿 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            덱별 카드 템플릿을 생성하고 관리합니다
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          새 템플릿
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            아직 템플릿이 없습니다
          </h3>
          <p className="text-gray-500 mb-6">
            첫 템플릿을 만들어 카드 구조를 정의하세요!
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            첫 템플릿 만들기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => {
            return (
              <div
                key={template.id}
                className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {template.name}
                      </h3>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="font-medium">필드:</span>
                    <span>{template.fields.length}개</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    생성: {new Date(template.createdAt).toLocaleDateString('ko-KR')}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    to={`/templates/${template.id}/edit`}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                  >
                    <Edit2 className="w-3 h-3" />
                    편집
                  </Link>
                  <button
                    onClick={() => handleDeleteTemplate(template.id)}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <CreateTemplateModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateTemplate}
        />
      )}
    </div>
  );
}

function CreateTemplateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: Partial<Template>) => void;
}) {
  const [name, setName] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('템플릿 이름을 입력해주세요.');
      return;
    }

    onCreate({
      name,
      fields: [
        { id: 'front', name: '앞면', type: 'text' },
        { id: 'back', name: '뒷면', type: 'text' },
      ],
      frontLayout: [{ fieldId: 'front' }],
      backLayout: [{ fieldId: 'front' }, { fieldId: 'back' }],
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 템플릿 만들기</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              템플릿 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 기본 카드"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              생성
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}