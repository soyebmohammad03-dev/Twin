import React, { useState } from 'react';
import { MemoryCategory, MemoryItem } from '../types';
import { ingestionApi } from '../services/ingestionApi';
import { toMemoryItem } from '../services/memoryMapper';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveMemory: (newMem: Omit<MemoryItem, 'id'>) => void;
  /** Phase 42: called after a real document upload/extraction completes with a genuinely new (non-duplicate) memory. */
  onDocumentIngested?: (mem: MemoryItem) => void;
}

type DocumentUploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'success'; isDuplicate: boolean; title: string | null }
  | { status: 'error'; message: string };

export const CaptureModal: React.FC<CaptureModalProps> = ({
  isOpen,
  onClose,
  onSaveMemory,
  onDocumentIngested,
}) => {
  const [activeType, setActiveType] = useState<'thought' | 'voice' | 'decision' | 'document'>('thought');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('ideas');
  const [tagsInput, setTagsInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [documentUpload, setDocumentUpload] = useState<DocumentUploadState>({ status: 'idle' });

  if (!isOpen) return null;

  async function handleDocumentFile(file: File) {
    if (file.type !== 'application/pdf') {
      setDocumentUpload({ status: 'error', message: 'Unsupported file type — only PDF documents are currently supported.' });
      return;
    }
    setDocumentUpload({ status: 'uploading' });
    try {
      const result = await ingestionApi.uploadDocument(file);
      if (!result.memory) {
        setDocumentUpload({ status: 'error', message: result.job.errorMessage ?? 'Could not extract text from this document.' });
        return;
      }
      setDocumentUpload({ status: 'success', isDuplicate: result.job.isDuplicate, title: result.memory.source.title });
      if (!result.job.isDuplicate) {
        onDocumentIngested?.(toMemoryItem(result.memory));
      }
    } catch (err) {
      setDocumentUpload({ status: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
    }
  }

  const handleStartVoice = () => {
    setIsRecording(true);
    setRecordingSeconds(0);
    const interval = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);

    setTimeout(() => {
      clearInterval(interval);
      setIsRecording(false);
      setTitle('Voice Memo: Q3 Spatial Glass Hierarchy');
      setDescription('Notes on maintaining consistent 24px outer radii and computing inner corners mathematically. Also discussed sync intervals for local Twin memories.');
      setCategory('ideas');
      setTagsInput('#voice, #design, #architecture');
    }, 3200);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !description.trim()) return;

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`));

    onSaveMemory({
      title: title.trim() || 'Untitled Thought',
      description: description.trim() || 'No additional details logged.',
      category,
      date: 'Just now',
      occurredAtIso: new Date().toISOString(),
      source: activeType === 'voice' ? 'Voice Note' : 'Manual Entry',
      sourceType: activeType === 'voice' ? 'voice' : 'manual',
      explicit: true,
      tags: tags.length > 0 ? tags : ['#captured'],
    });

    // Reset & close
    setTitle('');
    setDescription('');
    setTagsInput('');
    setIsRecording(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-heavy rounded-3xl w-full max-w-lg p-5 sm:p-6 border border-slate-200/80 dark:border-white/15 shadow-2xl relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">add_task</span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Capture into Memory
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Type Selector */}
        <div className="grid grid-cols-4 gap-2 my-4">
          <button
            type="button"
            onClick={() => setActiveType('thought')}
            className={`py-2 px-3 rounded-xl text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeType === 'thought'
                ? 'bg-indigo-600 dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] font-semibold'
                : 'liquid-glass text-slate-700 dark:text-slate-300'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">edit_note</span>
            <span>Note</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveType('voice');
              setCategory('ideas');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeType === 'voice'
                ? 'bg-indigo-600 dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] font-semibold'
                : 'liquid-glass text-slate-700 dark:text-slate-300'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">mic</span>
            <span>Voice Memo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveType('decision');
              setCategory('decisions');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeType === 'decision'
                ? 'bg-indigo-600 dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] font-semibold'
                : 'liquid-glass text-slate-700 dark:text-slate-300'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">gavel</span>
            <span>Decision</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveType('document');
              setDocumentUpload({ status: 'idle' });
            }}
            className={`py-2 px-3 rounded-xl text-xs font-mono flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeType === 'document'
                ? 'bg-indigo-600 dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] font-semibold'
                : 'liquid-glass text-slate-700 dark:text-slate-300'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">description</span>
            <span>Document</span>
          </button>
        </div>

        {/* Document upload panel — real PDF text extraction, honest states, no simulated processing */}
        {activeType === 'document' && (
          <div className="rounded-2xl liquid-glass p-4 mb-4 border border-indigo-500/30 space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload a PDF to extract its real text into a memory. Only PDFs with a real text layer are supported — no OCR yet.
            </p>
            <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-indigo-400/40 text-indigo-500 dark:text-indigo-300 text-xs font-mono cursor-pointer hover:border-indigo-400/70 transition-all">
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              <span>{documentUpload.status === 'uploading' ? 'Extracting…' : 'Choose a PDF file'}</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={documentUpload.status === 'uploading'}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleDocumentFile(file);
                }}
              />
            </label>
            {documentUpload.status === 'success' && (
              <p className="text-xs font-mono text-emerald-500">
                {documentUpload.isDuplicate
                  ? `Already in your memory: "${documentUpload.title ?? 'this document'}" — no duplicate created.`
                  : `Extracted and saved "${documentUpload.title ?? 'document'}" to your memory.`}
              </p>
            )}
            {documentUpload.status === 'error' && (
              <p className="text-xs font-mono text-rose-500">{documentUpload.message}</p>
            )}
          </div>
        )}

        {/* Voice Recording Simulation Panel */}
        {activeType === 'voice' && (
          <div className="rounded-2xl liquid-glass p-4 mb-4 flex flex-col items-center justify-center border border-indigo-500/30">
            {isRecording ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-rose-500 text-white flex items-center justify-center animate-pulse shadow-lg shadow-rose-500/40">
                  <span className="material-symbols-outlined text-2xl">mic</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span className="text-xs font-mono text-rose-400 font-semibold">
                    Recording... 00:0{recordingSeconds}
                  </span>
                </div>
                {/* Simulated live waveform */}
                <div className="flex items-center gap-1 h-6">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={i}
                      className="waveform-bar bg-rose-400"
                      style={{ animationDelay: `${i * 0.1}s` }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartVoice}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-600 text-white text-xs font-mono font-semibold hover:bg-indigo-700 transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">mic</span>
                <span>Tap to Record Voice Memo</span>
              </button>
            )}
          </div>
        )}

        {activeType === 'document' ? (
          <div className="pt-2 flex items-center justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-full bg-indigo-600 dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95 cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
        /* Input Form */
        <form onSubmit={handleSave} className="space-y-3.5">
          <div>
            <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Decision: Relocate design hub or Meeting with Sarah"
              className="w-full bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-1">
              Category
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['ideas', 'decisions', 'people', 'projects'] as MemoryCategory[]).map((cat) => (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-mono capitalize transition-all cursor-pointer ${
                    category === cat
                      ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/40 font-semibold'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200/60 dark:border-transparent'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-1">
              Details &amp; Context
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are the key drivers, participants, constraints, or decisions?"
              className="w-full bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-400 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-500 dark:text-slate-400 mb-1">
              Tags (comma separated)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. #design-system, #q3, #budget"
              className="w-full bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-400"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-xs font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-indigo-600 dark:bg-[#c2c1ff] text-white dark:text-[#1c0b9f] text-xs font-semibold hover:opacity-90 transition-all shadow-md active:scale-95 cursor-pointer"
            >
              Save to Twin Vault
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
