import ReactMarkdown from 'react-markdown';
import { Bot, ChevronDown, ChevronUp, Loader2, Maximize2, RefreshCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RelatedSearchFile } from './RelatedFilesStrip';

type AgentAnswerPanelProps = {
  answer?: string | null;
  loading: boolean;
  error?: string | null;
  conversationId?: string | null;
  debugTrace?: Record<string, any> | null;
  relatedFiles?: RelatedSearchFile[];
  composer?: ReactNode;
  onExpand?: () => void;
  streamStatus?: string | null;
};

const DebugSection = ({ title, content }: { title: string; content?: string | null }) => {
  if (!content) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-600">{title}</div>
      <pre className="whitespace-pre-wrap break-words text-[11px] leading-6 text-slate-600">{content}</pre>
    </div>
  );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeMarkdownLinkText = (value: string) => value.replace(/[[\]\\]/g, '\\$&');

const stripCodeWrappedFileNames = (answer: string, relatedFiles: RelatedSearchFile[]) => {
  let nextAnswer = answer;

  for (const file of relatedFiles) {
    const fileName = file.original_name?.trim();
    if (!fileName) continue;

    nextAnswer = nextAnswer.replace(new RegExp(`\`${escapeRegExp(fileName)}\``, 'g'), fileName);
  }

  return nextAnswer.replace(/`(\[[^`]+]\(\/files\/\d+\))`/g, '$1');
};

const buildLinkedAnswer = (answer: string, relatedFiles: RelatedSearchFile[]) => {
  if (!answer || relatedFiles.length === 0) return answer;

  let nextAnswer = stripCodeWrappedFileNames(answer, relatedFiles);
  const uniqueFiles = [...relatedFiles]
    .filter((file, index, all) => all.findIndex((item) => item.file_id === file.file_id) === index)
    .sort((left, right) => right.original_name.length - left.original_name.length);

  for (const file of uniqueFiles) {
    const fileName = file.original_name?.trim();
    if (!fileName) continue;

    const markdownLink = `[${escapeMarkdownLinkText(fileName)}](/files/${file.file_id})`;
    nextAnswer = nextAnswer.replace(new RegExp(`(^|[^\\[/])${escapeRegExp(fileName)}`, 'gm'), (_, prefix) => `${prefix}${markdownLink}`);
  }

  return nextAnswer;
};

const extractInlineText = (children: ReactNode) => {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map((item) => (typeof item === 'string' ? item : '')).join('');
  return '';
};

const matchTypeLabels: Record<string, string> = {
  exact: '标准问题精确命中',
  alias: '扩展问法精确命中',
  canonical_exact: '标准问题精确命中',
  alias_exact: '扩展问法精确命中',
  atomic_exact: '原子问题精确命中',
  atomic_phrase: '原子语义短语命中',
  atomic_lexical: '原子关键词命中',
  atomic_semantic: '原子向量语义命中',
  atomic_semantic_verified: '原子向量语义命中',
  atomic_semantic_candidate: '原子语义候选',
  semantic: '原子向量语义命中',
  semantic_candidate: '语义候选',
  none: '未命中预设',
};

const triggerTypeLabels: Record<string, string> = {
  canonical: '标准问题',
  canonical_fragment: '标准问题片段',
  alias: '扩展问法',
  alias_fragment: '扩展问法片段',
  keyword: '关键词',
  answer_fact: '答案事实',
  fact: '答案事实',
  derived_fact: '事实推导问法',
};

const verificationLabels: Record<string, string> = {
  published_trigger: '已发布索引校验',
  semantic_threshold_and_qualifier_guard: '语义阈值与限定词校验',
  qualifier_guard: '限定词安全拦截',
  reranker: '语义覆盖重排校验',
  reranker_rejected: '语义覆盖不足',
};

const AgentAnswerPanel = ({
  answer,
  loading,
  error,
  conversationId,
  debugTrace,
  relatedFiles = [],
  composer,
  onExpand,
  streamStatus,
}: AgentAnswerPanelProps) => {
  const [detailOpen, setDetailOpen] = useState(false);
  const navigate = useNavigate();
  const routing = (debugTrace?.routing || {}) as Record<string, any>;
  const stats = (debugTrace?.stats || {}) as Record<string, any>;
  const prompts = (debugTrace?.prompts || {}) as Record<string, any>;
  const modelTrace = Array.isArray(debugTrace?.model_trace) ? debugTrace?.model_trace : [];
  const scope = (debugTrace?.scope || {}) as Record<string, any>;
  const presetMatch = (debugTrace?.preset_match || {}) as Record<string, any>;
  const retrieval = (debugTrace?.retrieval || {}) as Record<string, any>;
  const linkedAnswer = useMemo(() => buildLinkedAnswer(answer || '', relatedFiles), [answer, relatedFiles]);
  const fileNameMap = useMemo(() => {
    const map = new Map<string, number>();
    relatedFiles.forEach((file) => {
      if (file.original_name) {
        map.set(file.original_name.trim(), file.file_id);
      }
    });
    return map;
  }, [relatedFiles]);

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white md:rounded-[32px]">

      <div className="relative border-b border-white/70 px-3 py-3 md:px-5 md:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#eefaf7] text-[#33beae]">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">Agent智能推荐</div>
              <div className="hidden text-xs text-slate-400 sm:block">根据知识库内容生成答案与推荐文件</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDetailOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
            >
              命中详情
              {detailOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
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

      <div className="custom-scrollbar search-panel-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5">
        {error ? (
          <div className="py-10 text-sm leading-7 text-red-500">
            {error}
          </div>
        ) : answer ? (
          <div className="flex min-h-full flex-col">
            {streamStatus ? (
              <div className="mb-4 flex items-center gap-2 rounded-2xl border border-[#c9eeea] bg-[#f0fbfa] px-3.5 py-2.5 text-xs text-[#208e8d]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />{streamStatus}
              </div>
            ) : null}
            <article className="prose prose-slate max-w-none text-sm leading-7 prose-p:my-3 prose-ul:my-3 prose-ol:my-3">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => <h1 className="mb-4 text-xl font-semibold leading-8 text-slate-900">{children}</h1>,
                  h2: ({ children }) => <h2 className="mt-6 border-b border-slate-100 pb-2 text-lg font-semibold leading-7 text-slate-800">{children}</h2>,
                  h3: ({ children }) => <h3 className="mt-5 text-base font-semibold leading-7 text-slate-800">{children}</h3>,
                  p: ({ children }) => <p className="my-3 text-[14px] leading-7 text-slate-700">{children}</p>,
                  ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-5 text-[14px] leading-7 text-slate-700">{children}</ul>,
                  ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-5 text-[14px] leading-7 text-slate-700">{children}</ol>,
                  li: ({ children }) => <li className="pl-1">{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="my-4 rounded-r-2xl border-l-4 border-[#7ed9dd] bg-[#f2fbfb] px-4 py-3 text-[13px] leading-6 text-slate-600">
                      {children}
                    </blockquote>
                  ),
                  a: ({ href, children }) => {
                    if (href?.startsWith('/files/')) {
                      return (
                        <button
                          type="button"
                          onClick={() => navigate(href, { state: { from: 'search' } })}
                          className="mx-0.5 inline rounded-md bg-[#e8fbfa] px-1.5 py-0.5 font-medium text-[#26aeb3] underline decoration-[#7ed9dd] decoration-2 underline-offset-2 transition-colors hover:bg-[#d7f8f6] hover:text-[#1f9498]"
                        >
                          {children}
                        </button>
                      );
                    }
                    return (
                      <a href={href} className="text-[#26aeb3] underline decoration-[#7ed9dd] decoration-2 underline-offset-2">
                        {children}
                      </a>
                    );
                  },
                  code: ({ children, className }) => {
                    const text = extractInlineText(children).trim();
                    const isInlineCode = !className && !text.includes('\n');
                    const rawLinkMatch = text.match(/^\[([^\]]+)\]\((\/files\/\d+)\)$/);
                    const fileIdFromName = fileNameMap.get(text);

                    if (isInlineCode && rawLinkMatch) {
                      const [, label, href] = rawLinkMatch;
                      return (
                        <button
                          type="button"
                          onClick={() => navigate(href, { state: { from: 'search' } })}
                          className="mx-0.5 inline rounded-md bg-[#e8fbfa] px-1.5 py-0.5 font-medium text-[#26aeb3] underline decoration-[#7ed9dd] decoration-2 underline-offset-2 transition-colors hover:bg-[#d7f8f6] hover:text-[#1f9498]"
                        >
                          {label}
                        </button>
                      );
                    }

                    if (isInlineCode && fileIdFromName) {
                      return (
                        <button
                          type="button"
                          onClick={() => navigate(`/files/${fileIdFromName}`, { state: { from: 'search' } })}
                          className="mx-0.5 inline rounded-md bg-[#e8fbfa] px-1.5 py-0.5 font-medium text-[#26aeb3] underline decoration-[#7ed9dd] decoration-2 underline-offset-2 transition-colors hover:bg-[#d7f8f6] hover:text-[#1f9498]"
                        >
                          {text}
                        </button>
                      );
                    }

                    return (
                      <code className={className || 'rounded-md bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-700'}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {linkedAnswer}
              </ReactMarkdown>
            </article>
            {detailOpen ? (
              <div className="mt-6 space-y-3 border-t border-slate-100 pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-semibold text-slate-600">回答来源</div>
                    <div className="space-y-1 text-[11px] leading-6 text-slate-600">
                      <div>会话 ID：{conversationId || '-'}</div>
                      <div>处理方式：{presetMatch.matched ? '文件夹预设优先' : '知识库向量检索'}</div>
                      <div>检索范围：{scope.mode === 'current_folder_subtree' ? '当前目录及子目录' : '账号全部可见目录'}</div>
                      <div>权限来源：{routing.route_source === 'folder_permissions' ? '实时文件权限' : routing.route_source || '-'}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-xs font-semibold text-slate-600">命中统计</div>
                    <div className="space-y-1 text-[11px] leading-6 text-slate-600">
                      <div>预设候选数：{presetMatch.candidate_count ?? 0}</div>
                      <div>范围文件数：{stats.scoped_file_count ?? stats.visible_file_count ?? 0}</div>
                      <div>命中证据数：{stats.evidence_count ?? 0}</div>
                      <div>推荐文件数：{stats.related_file_count ?? 0}</div>
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl border p-3 ${presetMatch.matched ? 'border-[#bce9e3] bg-[#effbf9]' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="mb-2 text-xs font-semibold text-slate-600">预设问题匹配</div>
                  <div className="grid gap-x-4 gap-y-1 text-[11px] leading-6 text-slate-600 md:grid-cols-2">
                    <div>结果：{presetMatch.matched ? '已命中并优先回答' : '未高置信命中'}</div>
                    <div>方式：{matchTypeLabels[presetMatch.match_type] || presetMatch.match_type || '未命中预设'}</div>
                    <div>绑定目录：{presetMatch.folder_name || '-'}</div>
                    <div>相似度：{typeof presetMatch.score === 'number' ? presetMatch.score.toFixed(4) : '-'}</div>
                    <div>标准问题：{presetMatch.question || '-'}</div>
                    <div>继承命中：{presetMatch.inherited ? '是' : '否'}</div>
                    <div>触发类型：{triggerTypeLabels[presetMatch.trigger_type] || presetMatch.trigger_type || '-'}</div>
                    <div>置信分差：{typeof presetMatch.margin === 'number' ? presetMatch.margin.toFixed(4) : '-'}</div>
                    <div className="md:col-span-2">命中问法：{presetMatch.trigger_text || '-'}</div>
                    <div>安全校验：{verificationLabels[presetMatch.verification_method] || presetMatch.verification_method || '-'}</div>
                    <div>校验耗时：{presetMatch.verification_ms != null ? `${presetMatch.verification_ms} ms` : '-'}</div>
                  </div>
                  {presetMatch.evidence_text ? (
                    <div className="mt-3 rounded-xl border border-[#d6efeb] bg-white/80 px-3 py-2.5">
                      <div className="mb-1 text-[10px] font-semibold text-[#278f88]">本次回答证据</div>
                      <div className="whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-600">{presetMatch.evidence_text}</div>
                    </div>
                  ) : null}
                  {Array.isArray(presetMatch.unsupported_qualifiers) && presetMatch.unsupported_qualifiers.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                      已安全降级到文件检索，预设答案未覆盖：{presetMatch.unsupported_qualifiers.join('、')}
                    </div>
                  ) : null}
                  <div className="mt-2 text-[11px] leading-5 text-slate-500">{presetMatch.reason || '未提供匹配说明'}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-600">后置文件检索</div>
                  <div className="grid gap-x-4 gap-y-1 text-[11px] leading-6 text-slate-600 md:grid-cols-2">
                    <div>是否执行：{retrieval.ran ? '是' : '否'}</div>
                    <div>范围模式：{retrieval.mode || '-'}</div>
                    <div>耗时：{retrieval.elapsed_ms != null ? `${retrieval.elapsed_ms} ms` : '-'}</div>
                    <div>重排：{retrieval.rerank?.used ? 'LLM 重排' : '向量顺序'}</div>
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-slate-500">{retrieval.summary || '等待检索结果'}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-600">推导过程</div>
                  <div className="space-y-2">
                    {modelTrace.length > 0 ? (
                      modelTrace.map((item: any, index: number) => (
                        <div key={`${item.stage || 'trace'}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-6 text-slate-600">
                          <div className="font-medium text-slate-700">
                            {item.stage || `stage-${index + 1}`} / {item.mode || '-'}
                          </div>
                          <div>{item.summary || '-'}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-[11px] text-slate-500">暂无推导过程。</div>
                    )}
                  </div>
                </div>

                <DebugSection title="文件重排提示词" content={prompts?.rerank?.system ? `System:\n${prompts.rerank.system}\n\nUser:\n${prompts.rerank.user}` : null} />
                <DebugSection title="最终回答提示词" content={prompts?.answer?.system ? `System:\n${prompts.answer.system}\n\nUser:\n${prompts.answer.user}` : null} />
              </div>
            ) : null}
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
        ) : loading ? (
          <div className="flex items-center gap-3 py-10 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            {streamStatus || 'AI 正在确认目录权限与预设问题...'}
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
