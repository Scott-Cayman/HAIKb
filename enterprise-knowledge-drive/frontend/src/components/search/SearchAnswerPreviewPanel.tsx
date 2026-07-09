import ReactMarkdown from 'react-markdown';
import { Bot, Maximize2, X } from 'lucide-react';

type SearchAnswerPreviewPanelProps = {
  answer?: string | null;
  error?: string | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
};

const SearchAnswerPreviewPanel = ({
  answer,
  error,
  loading,
  open,
  onClose,
}: SearchAnswerPreviewPanelProps) => {
  if (!open) return null;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[28px] border border-white/75 bg-white/74 shadow-[0_18px_38px_rgba(189,204,226,0.14)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#77ecdd] to-[#8fb8ff] text-white shadow-[0_12px_24px_rgba(116,219,214,0.28)]">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">展开查看 AI 回复</div>
            <div className="mt-1 text-xs text-slate-400">右侧完整展示本轮 AI 回答内容</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="关闭 AI 回复展开面板"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {loading ? (
          <div className="py-10 text-sm text-slate-500">AI 正在整理回答内容...</div>
        ) : error ? (
          <div className="py-10 text-sm leading-7 text-red-500">{error}</div>
        ) : answer ? (
          <article className="prose prose-slate max-w-none text-sm leading-7 prose-p:my-3 prose-ul:my-3 prose-ol:my-3">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </article>
        ) : (
          <div className="flex min-h-[240px] flex-col items-center justify-center text-center text-sm text-slate-500">
            <Maximize2 className="mb-3 h-6 w-6 text-slate-300" />
            当前还没有可展开的 AI 回复内容
          </div>
        )}
      </div>
    </aside>
  );
};

export default SearchAnswerPreviewPanel;
