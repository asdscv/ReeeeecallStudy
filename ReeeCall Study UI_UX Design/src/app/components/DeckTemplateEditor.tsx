import { useState } from 'react';
import { GripVertical, Trash2, Plus, X, Volume2 } from 'lucide-react';
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

interface DeckTemplateEditorProps {
  deck: {
    fields: Field[];
    frontLayout: LayoutItem[];
    backLayout: LayoutItem[];
  };
  onTemplateChange: (updates: { fields: Field[]; frontLayout: LayoutItem[]; backLayout: LayoutItem[] }) => void;
  availableVoices?: SpeechSynthesisVoice[];
}

export function DeckTemplateEditor({
  deck,
  onTemplateChange,
  availableVoices = [],
}: DeckTemplateEditorProps) {
  const { fields, frontLayout, backLayout } = deck;

  function addField() {
    if (fields.length >= 10) {
      toast.error('필드는 최대 10개까지 추가할 수 있습니다.');
      return;
    }

    const newField: Field = {
      id: `field_${Date.now()}`,
      name: `필드 ${fields.length + 1}`,
      type: 'text',
    };

    onTemplateChange({ fields: [...fields, newField], frontLayout, backLayout });
  }

  function removeField(fieldId: string) {
    onTemplateChange({
      fields: fields.filter((f) => f.id !== fieldId),
      frontLayout: frontLayout.filter((l) => l.fieldId !== fieldId),
      backLayout: backLayout.filter((l) => l.fieldId !== fieldId),
    });
  }

  function updateFieldName(fieldId: string, name: string) {
    onTemplateChange({
      fields: fields.map((f) => (f.id === fieldId ? { ...f, name } : f)),
      frontLayout,
      backLayout,
    });
  }

  function updateFieldType(fieldId: string, type: Field['type']) {
    onTemplateChange({
      fields: fields.map((f) => (f.id === fieldId ? { ...f, type } : f)),
      frontLayout,
      backLayout,
    });
  }

  function updateFieldTTS(fieldId: string, updates: Partial<Field>) {
    onTemplateChange({
      fields: fields.map((f) => (f.id === fieldId ? { ...f, ...updates } : f)),
      frontLayout,
      backLayout,
    });
  }

  function addToFrontLayout(fieldId: string) {
    if (frontLayout.some((l) => l.fieldId === fieldId)) {
      toast.error('이미 앞면에 추가된 필드입니다.');
      return;
    }

    onTemplateChange({
      fields,
      frontLayout: [...frontLayout, { fieldId }],
      backLayout,
    });
  }

  function addToBackLayout(fieldId: string) {
    if (backLayout.some((l) => l.fieldId === fieldId)) {
      toast.error('이미 뒷면에 추가된 필드입니다.');
      return;
    }

    onTemplateChange({
      fields,
      frontLayout,
      backLayout: [...backLayout, { fieldId }],
    });
  }

  function removeFromFrontLayout(fieldId: string) {
    onTemplateChange({
      fields,
      frontLayout: frontLayout.filter((l) => l.fieldId !== fieldId),
      backLayout,
    });
  }

  function removeFromBackLayout(fieldId: string) {
    onTemplateChange({
      fields,
      frontLayout,
      backLayout: backLayout.filter((l) => l.fieldId !== fieldId),
    });
  }

  function getVoicesForLang(lang: string) {
    return availableVoices.filter((voice) => voice.lang.startsWith(lang.split('-')[0]));
  }

  function testTTS(field: Field) {
    if (!field.ttsEnabled || !field.ttsLang) return;

    const utterance = new SpeechSynthesisUtterance('안녕하세요');
    utterance.lang = field.ttsLang;

    if (field.ttsVoice) {
      const voice = availableVoices.find((v) => v.name === field.ttsVoice);
      if (voice) utterance.voice = voice;
    }

    speechSynthesis.speak(utterance);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Field Management */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">필드 관리</h2>
            <span className="text-sm text-gray-500">
              (최대 10개, 현재 {fields.length}개)
            </span>
          </div>

          <div className="space-y-2 mb-4">
            {fields.map((field, index) => (
              <div key={field.id} className="bg-gray-50 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 p-3">
                  <GripVertical className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500 w-6">{index + 1}</span>
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateFieldName(field.id, e.target.value)}
                    className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateFieldType(field.id, e.target.value as Field['type'])}
                    className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="text">텍스트</option>
                    <option value="image">이미지</option>
                    <option value="audio">오디오</option>
                  </select>
                  {field.type === 'text' && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-white rounded border border-gray-300">
                      <Volume2 className={`w-3 h-3 ${field.ttsEnabled ? 'text-blue-600' : 'text-gray-400'}`} />
                      <input
                        type="checkbox"
                        checked={field.ttsEnabled || false}
                        onChange={(e) =>
                          updateFieldTTS(field.id, { ttsEnabled: e.target.checked })
                        }
                        className="w-3 h-3 text-blue-600 rounded focus:ring-2 focus:ring-blue-500/20"
                        title="TTS 활성화"
                      />
                    </div>
                  )}
                  <button
                    onClick={() => removeField(field.id)}
                    className="p-1 text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* TTS Settings (Show when enabled) */}
                {field.type === 'text' && field.ttsEnabled && (
                  <div className="px-3 pb-3 space-y-3 border-t border-gray-200 pt-3 bg-white">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        언어
                      </label>
                      <select
                        value={field.ttsLang || ''}
                        onChange={(e) => {
                          updateFieldTTS(field.id, {
                            ttsLang: e.target.value,
                            ttsVoice: '',
                          });
                        }}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value="">언어 선택</option>
                        <option value="ko-KR">한국어</option>
                        <option value="en-US">영어 (미국)</option>
                        <option value="en-GB">영어 (영국)</option>
                        <option value="ja-JP">일본어</option>
                        <option value="zh-CN">중국어 (간체)</option>
                        <option value="zh-TW">중국어 (번체)</option>
                        <option value="es-ES">스페인어</option>
                        <option value="fr-FR">프랑스어</option>
                        <option value="de-DE">독일어</option>
                        <option value="ru-RU">러시아어</option>
                      </select>
                    </div>

                    {field.ttsLang && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          음성
                        </label>
                        <select
                          value={field.ttsVoice || ''}
                          onChange={(e) =>
                            updateFieldTTS(field.id, { ttsVoice: e.target.value })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="">기본 음성</option>
                          {getVoicesForLang(field.ttsLang).map((voice) => (
                            <option key={voice.name} value={voice.name}>
                              {voice.name} {voice.localService ? '(로컬)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      onClick={() => testTTS(field)}
                      disabled={!field.ttsLang}
                      className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Volume2 className="w-3 h-3" />
                      테스트
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addField}
            disabled={fields.length >= 10}
            className="w-full py-2 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            필드 추가
          </button>
        </div>
      </div>

      {/* Right: Front/Back Layout */}
      <div className="space-y-4">
        {/* Front Layout */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">앞면 설정</h2>
          <div className="space-y-2 mb-4">
            {frontLayout.map((item) => {
              const field = fields.find((f) => f.id === item.fieldId);
              return (
                <div key={item.fieldId} className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                  <span className="flex-1 text-sm font-medium text-gray-900">
                    {field?.name}
                  </span>
                  <button
                    onClick={() => removeFromFrontLayout(item.fieldId)}
                    className="p-1 text-red-500 hover:text-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add field dropdown */}
          <div className="mb-4">
            <select
              onChange={(e) => {
                if (e.target.value) {
                  addToFrontLayout(e.target.value);
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">+ 필드 추가</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </div>

          <div className="relative p-6 bg-gray-50 rounded-xl min-h-[200px]">
            <div className="absolute top-3 right-3 text-xs text-gray-400 font-medium">
              미리보기
            </div>
            <div className="space-y-4 pt-6">
              {frontLayout.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  필드를 추가해주세요
                </div>
              ) : (
                frontLayout.map((item) => {
                  const field = fields.find((f) => f.id === item.fieldId);
                  if (!field) return null;
                  return (
                    <div key={item.fieldId} className="text-center">
                      <div className="text-xs text-gray-500 mb-1">[{field.name}]</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {field.type === 'text' && '텍스트 내용'}
                        {field.type === 'image' && '🖼️ 이미지'}
                        {field.type === 'audio' && '🔊 오디오'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Back Layout */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">뒷면 설정</h2>
          <div className="space-y-2 mb-4">
            {backLayout.map((item) => {
              const field = fields.find((f) => f.id === item.fieldId);
              return (
                <div key={item.fieldId} className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                  <span className="flex-1 text-sm font-medium text-gray-900">
                    {field?.name}
                  </span>
                  <button
                    onClick={() => removeFromBackLayout(item.fieldId)}
                    className="p-1 text-red-500 hover:text-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add field dropdown */}
          <div className="mb-4">
            <select
              onChange={(e) => {
                if (e.target.value) {
                  addToBackLayout(e.target.value);
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg hover:border-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">+ 필드 추가</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </div>

          <div className="relative p-6 bg-gray-50 rounded-xl min-h-[200px]">
            <div className="absolute top-3 right-3 text-xs text-gray-400 font-medium">
              미리보기
            </div>
            <div className="space-y-4 pt-6">
              {backLayout.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  필드를 추가해주세요
                </div>
              ) : (
                backLayout.map((item) => {
                  const field = fields.find((f) => f.id === item.fieldId);
                  if (!field) return null;
                  return (
                    <div key={item.fieldId} className="text-center">
                      <div className="text-xs text-gray-500 mb-1">[{field.name}]</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {field.type === 'text' && '텍스트 내용'}
                        {field.type === 'image' && '🖼️ 이미지'}
                        {field.type === 'audio' && '🔊 오디오'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}