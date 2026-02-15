import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { getTemplate, updateTemplate } from '../lib/storage';
import { DeckTemplateEditor } from '../components/DeckTemplateEditor';
import { toast } from 'sonner';

interface Field {
  id: string;
  name: string;
  type: 'text' | 'image' | 'audio';
  ttsEnabled?: boolean;
  ttsLang?: string;
  ttsVoice?: string;
}

interface LayoutItem {
  fieldId: string;
}

interface Template {
  id: string;
  name: string;
  fields: Field[];
  frontLayout: LayoutItem[];
  backLayout: LayoutItem[];
}

export function TemplateEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    fetchTemplate();
    loadVoices();
  }, [id]);

  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    setAvailableVoices(voices);

    if (voices.length === 0) {
      speechSynthesis.onvoiceschanged = () => {
        setAvailableVoices(speechSynthesis.getVoices());
      };
    }
  }

  function fetchTemplate() {
    try {
      const data = getTemplate(id!);
      if (!data) {
        toast.error('템플릿을 찾을 수 없습니다.');
        navigate('/templates');
        return;
      }

      setTemplate(data);
    } catch (error) {
      console.error('Error fetching template:', error);
      toast.error('템플릿을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function handleTemplateChange(updates: {
    fields: Field[];
    frontLayout: LayoutItem[];
    backLayout: LayoutItem[];
  }) {
    if (!template) return;

    try {
      const updatedTemplate = updateTemplate(template.id, updates);
      setTemplate(updatedTemplate);
      toast.success('템플릿이 저장되었습니다!');
    } catch (error) {
      console.error('Error updating template:', error);
      toast.error('템플릿 저장에 실패했습니다.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (!template) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/templates')}
          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
        </div>
      </div>

      {/* Template Editor */}
      <DeckTemplateEditor
        deck={{
          fields: template.fields,
          frontLayout: template.frontLayout,
          backLayout: template.backLayout,
        }}
        onTemplateChange={handleTemplateChange}
        availableVoices={availableVoices}
      />
    </div>
  );
}