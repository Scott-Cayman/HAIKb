import ReactMarkdown from 'react-markdown';
import { Bot, Loader2, Maximize2, RefreshCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ReactNode } from 'react';

type AgentAnswerPanelProps = {
  answer?: string | null;
  loading: boolean;
  error?: string | null;
  conversationId?: string | null;
  composer?: ReactNode;
  onExpand?: () => void;
};

const AgentAnswerPanel = ({ answer, loading, error, conversationId, composer, onExpand }: AgentAnswerPanelProps) => {
  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white">

      <div className="relative border-b border-white/70 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#eefaf7] text-[#33beae]">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">Agent智能推荐</div>
              <div className="text-xs text-slate-400">根据知识库内容生成答案与推荐文件</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conversationId ? (
              <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                会话 {conversationId.slice(0, 8)}
              </div>
            ) : null}
            {onExpand ? (
              <button
                type="button"
                onClick={onExpand}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-500"
                aria-label="在右侧展开 AI 回复"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="custom-scrollbar search-panel-scrollbar relative min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {loading ? (
          <div className="flex items-center gap-3 py-10 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            AI 正在整理推荐文件与回答内容...
          </div>
        ) : error ? (
          <div className="py-10 text-sm leading-7 text-red-500">
            {error}
          </div>
        ) : answer ? (
          <div className="flex min-h-full flex-col">
            <article className="prose prose-slate max-w-none text-sm leading-7 prose-p:my-3 prose-ul:my-3 prose-ol:my-3">
              <ReactMarkdown>{answer}</ReactMarkdown>
            </article>
            <div className="mt-6 flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-400">
              <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-slate-600">
                <ThumbsUp className="h-3.5 w-3.5" />
                有帮助
              </button>
              <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-slate-600">
                <ThumbsDown className="h-3.5 w-3.5" />
                不满意
              </button>
              <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-slate-600">
                <RefreshCcw className="h-3.5 w-3.5" />
                重新回答
              </button>
            </div>
          </div>
        ) : (
          <div className="py-10 text-sm text-slate-500">
            输入问题后，这里会展示 Agent 回答、依据总结出的判断，以及推荐的文件。
          </div>
        )}
      </div>

      {composer ? <div className="relative border-t border-white/70 bg-white/70 px-3 py-3 md:px-4">{composer}</div> : null}
    </section>
  );
};

export default AgentAnswerPanel;
