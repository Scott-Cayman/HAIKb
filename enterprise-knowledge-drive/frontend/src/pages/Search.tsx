import { useEffect, useRef, useState } from 'react';
import { Search as SearchIcon, Sparkles } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { agentApi, AgentChatResponse, RelatedFileItem, type AgentStreamEvent } from '../services/agentApi';
import api from '../services/api';
import SearchComposer from '../components/search/SearchComposer';
import { RelatedSearchFile } from '../components/search/RelatedFilesStrip';
import AgentAnswerPanel from '../components/search/AgentAnswerPanel';
import SearchFilePreviewPanel from '../components/search/SearchFilePreviewPanel';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { keywordSearchApi, type KeywordSearchResponse } from '../services/keywordSearch';

const FALLBACK_SUGGESTIONS = ['新人培训流程', '如何使用报销系统', '项目复盘模板', '公司制度有哪些'];
const SEARCH_PAGE_STORAGE_KEY = 'enterprise-knowledge-drive:ai-search-state';
const HERO_SUGGESTION_PAGE_SIZE = 4;
const DEFAULT_STACKED_SPLIT = 0.58;
const MIN_AGENT_PANEL_HEIGHT = 220;
const MIN_RELATED_PANEL_HEIGHT = 260;
const SPLITTER_HEIGHT = 14;

const shuffleSuggestions = (items: string[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

type SearchPagePersistedState = {
  query: string;
  searchType: 'ai' | 'keyword';
  error: string | null;
  result: AgentChatResponse | null;
  relatedFiles: RelatedSearchFile[];
  hasSearched: boolean;
  keywordMeta: Pick<KeywordSearchResponse, 'total' | 'tokens' | 'elapsed_ms'> | null;
};

const loadSearchPageState = (): SearchPagePersistedState => {
  if (typeof window === 'undefined') {
    return {
      query: '',
      searchType: 'ai',
      error: null,
      result: null,
      relatedFiles: [],
      hasSearched: false,
      keywordMeta: null,
    };
  }

  try {
    const raw = window.sessionStorage.getItem(SEARCH_PAGE_STORAGE_KEY);
    if (!raw) {
      return {
        query: '',
        searchType: 'ai',
        error: null,
        result: null,
        relatedFiles: [],
        hasSearched: false,
        keywordMeta: null,
      };
    }

    const parsed = JSON.parse(raw) as Partial<SearchPagePersistedState>;
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      searchType: parsed.searchType === 'keyword' ? 'keyword' : 'ai',
      error: typeof parsed.error === 'string' ? parsed.error : null,
      result: parsed.result ?? null,
      relatedFiles: Array.isArray(parsed.relatedFiles) ? parsed.relatedFiles : [],
      hasSearched: Boolean(parsed.hasSearched || parsed.result || (Array.isArray(parsed.relatedFiles) && parsed.relatedFiles.length > 0)),
      keywordMeta: parsed.keywordMeta ?? null,
    };
  } catch (error) {
    console.error('Failed to restore AI search state', error);
    return {
      query: '',
      searchType: 'ai',
      error: null,
      result: null,
      relatedFiles: [],
      hasSearched: false,
      keywordMeta: null,
    };
  }
};

const toDisplayFiles = (files: RelatedFileItem[]) =>
  files.map((file) => ({
    ...file,
    preview_status: 'unsupported',
    file_ext: null,
  }));

const Search = () => {
  const [searchParams] = useSearchParams();
  const currentFolderId = Number(searchParams.get('folderId') || 0) || undefined;
  const requestedQuery = (searchParams.get('q') || '').trim();
  const requestedMode = searchParams.get('mode') === 'keyword' ? 'keyword' : searchParams.get('mode') === 'ai' ? 'ai' : null;
  const initialState = loadSearchPageState();
  const [query, setQuery] = useState<string>(requestedQuery || initialState.query);
  const [searchType, setSearchType] = useState<'ai' | 'keyword'>(requestedMode || initialState.searchType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(requestedQuery ? null : initialState.error);
  const [result, setResult] = useState<AgentChatResponse | null>(requestedQuery ? null : initialState.result);
  const [relatedFiles, setRelatedFiles] = useState<RelatedSearchFile[]>(requestedQuery ? [] : initialState.relatedFiles);
  const [hasSearched, setHasSearched] = useState(requestedQuery ? false : initialState.hasSearched);
  const [keywordMeta, setKeywordMeta] = useState<Pick<KeywordSearchResponse, 'total' | 'tokens' | 'elapsed_ms'> | null>(
    requestedQuery ? null : initialState.keywordMeta,
  );
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [visibleSuggestions, setVisibleSuggestions] = useState<string[]>(shuffleSuggestions(FALLBACK_SUGGESTIONS).slice(0, HERO_SUGGESTION_PAGE_SIZE));
  const [stackedSplit, setStackedSplit] = useState(DEFAULT_STACKED_SPLIT);
  const autoSearchStarted = useRef(false);
  const stackedResultRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{
    pointerId: number;
    top: number;
    availableHeight: number;
    minSplit: number;
    maxSplit: number;
  } | null>(null);
  const { loadFavoriteStatus } = useFavoriteStatus();

  useEffect(() => {
    let cancelled = false;

    const loadSuggestedQuestions = async () => {
      try {
        const response = await agentApi.getSuggestedQuestions(12, currentFolderId);
        if (cancelled) return;
        const nextSuggestions = response.questions?.length ? response.questions : FALLBACK_SUGGESTIONS;
        setVisibleSuggestions(shuffleSuggestions(nextSuggestions).slice(0, HERO_SUGGESTION_PAGE_SIZE));
      } catch (loadError) {
        console.error('Failed to load suggested questions', loadError);
        if (cancelled) return;
        setVisibleSuggestions(shuffleSuggestions(FALLBACK_SUGGESTIONS).slice(0, HERO_SUGGESTION_PAGE_SIZE));
      }
    };

    void loadSuggestedQuestions();
    return () => {
      cancelled = true;
    };
  }, [currentFolderId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasPersistedState = Boolean(query || error || result || relatedFiles.length > 0 || hasSearched);
    if (!hasPersistedState && searchType === 'ai') {
      window.sessionStorage.removeItem(SEARCH_PAGE_STORAGE_KEY);
      return;
    }

    const stateToPersist: SearchPagePersistedState = {
      query,
      searchType,
      error,
      result,
      relatedFiles,
      hasSearched,
      keywordMeta,
    };
    window.sessionStorage.setItem(SEARCH_PAGE_STORAGE_KEY, JSON.stringify(stateToPersist));
  }, [error, hasSearched, keywordMeta, query, relatedFiles, result, searchType]);

  useEffect(() => {
    const fileIds = relatedFiles.map((file) => file.file_id);
    if (fileIds.length === 0) return;

    loadFavoriteStatus({ fileIds }).catch((loadError) => {
      console.error('Failed to load favorite status', loadError);
    });
  }, [relatedFiles, loadFavoriteStatus]);

  useEffect(() => {
    const enrichRelatedFiles = async () => {
      const pendingFiles = relatedFiles.filter((file) => !file.preview_status || !file.file_ext);
      if (pendingFiles.length === 0) return;

      try {
        const responses = await Promise.all(
          pendingFiles.map(async (file) => {
            const response = await api.get(`/files/${file.file_id}`);
            return {
              fileId: file.file_id,
              fileExt: response.data?.file_ext ?? null,
              previewStatus: response.data?.preview_status ?? 'unsupported',
              createdAt: response.data?.created_at ?? null,
              size: response.data?.size ?? null,
            };
          }),
        );

        setRelatedFiles((current) =>
          current.map((item) => {
            const matched = responses.find((response) => response.fileId === item.file_id);
            if (!matched) return item;
            return {
              ...item,
              file_ext: matched.fileExt,
              preview_status: matched.previewStatus,
              created_at: matched.createdAt,
              size: matched.size,
            };
          }),
        );
      } catch (loadError) {
        console.error('Failed to enrich related files', loadError);
      }
    };

    enrichRelatedFiles();
  }, [relatedFiles]);

  const runAiSearch = async (nextQuery: string) => {
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) return;

    const conversationId = result?.conversation_id;
    setQuery(trimmedQuery);
    setLoading(true);
    setError(null);
    setResult(null);
    setRelatedFiles([]);
    setKeywordMeta(null);
    setHasSearched(true);
    setStreamStatus('正在确认目录权限与预设问题…');

    try {
      let streamedAnswer = '';
      let streamedConversationId = conversationId || '';
      let streamedDebug: Record<string, any> = {};
      const handleEvent = (event: AgentStreamEvent) => {
        if (event.type === 'start') {
          streamedConversationId = event.conversation_id;
          streamedDebug = { ...streamedDebug, scope: event.scope || {} };
          setResult({ conversation_id: streamedConversationId, answer: '', evidence: [], related_files: [], debug_trace: streamedDebug });
        } else if (event.type === 'preset_match') {
          streamedDebug = { ...streamedDebug, preset_match: event.preset_match };
          setResult((current) => current ? { ...current, debug_trace: streamedDebug } : current);
        } else if (event.type === 'status') {
          setStreamStatus(event.message);
        } else if (event.type === 'answer_delta') {
          streamedAnswer += event.delta;
          setResult((current) => ({
            conversation_id: current?.conversation_id || streamedConversationId,
            answer: streamedAnswer,
            evidence: current?.evidence || [],
            related_files: current?.related_files || [],
            routing: current?.routing,
            debug_trace: current?.debug_trace || streamedDebug,
          }));
        } else if (event.type === 'answer_replace') {
          streamedAnswer = event.answer;
          setResult((current) => current ? { ...current, answer: event.answer } : current);
        } else if (event.type === 'sources') {
          streamedDebug = event.debug_trace || streamedDebug;
          const response: AgentChatResponse = {
            conversation_id: streamedConversationId,
            answer: streamedAnswer,
            evidence: event.evidence || [],
            related_files: event.related_files || [],
            routing: event.routing,
            debug_trace: streamedDebug,
          };
          setResult(response);
          setRelatedFiles(toDisplayFiles(response.related_files));
          setStreamStatus(null);
        } else if (event.type === 'done') {
          setStreamStatus(null);
        }
      };
      await agentApi.chatStream(
        { query: trimmedQuery, conversation_id: conversationId, top_k: 8, retrieval_mode: 'hybrid', current_folder_id: currentFolderId },
        handleEvent,
      );
    } catch (err: any) {
      if (err?.code === 'ECONNABORTED') {
        setError('AI 检索超时，请稍后重试');
      } else {
        setError(err?.response?.data?.detail || err?.message || 'AI 检索失败，请稍后重试');
      }
    } finally {
      setLoading(false);
      setStreamStatus(null);
    }
  };

  const runKeywordSearch = async (nextQuery: string) => {
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) return;

    setQuery(trimmedQuery);
    setLoading(true);
    setError(null);
    setResult(null);
    setRelatedFiles([]);
    setStreamStatus(null);
    setHasSearched(true);

    try {
      const response = await keywordSearchApi.search(trimmedQuery, currentFolderId, 500);
      setRelatedFiles(response.results as RelatedSearchFile[]);
      setKeywordMeta({
        total: response.total,
        tokens: response.tokens,
        elapsed_ms: response.elapsed_ms,
      });
    } catch (err: any) {
      setKeywordMeta(null);
      setError(err?.response?.data?.detail || err?.message || '关键词检索失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (value: string) => {
    setQuery(value);
    void runAiSearch(value);
  };

  const handleKeywordSearchClick = (value: string) => {
    if (!value.trim()) return;
    void runKeywordSearch(value);
  };

  const handleSearchTypeChange = (nextType: 'ai' | 'keyword') => {
    if (nextType === searchType) return;
    setSearchType(nextType);
    setError(null);
    setResult(null);
    setRelatedFiles([]);
    setKeywordMeta(null);
    setHasSearched(false);
    setStreamStatus(null);
  };

  const updateStackedSplitFromPointer = (clientY: number) => {
    const dragState = splitDragRef.current;
    if (!dragState) return;

    const requestedHeight = clientY - dragState.top - SPLITTER_HEIGHT / 2;
    const nextSplit = requestedHeight / dragState.availableHeight;
    setStackedSplit(Math.min(dragState.maxSplit, Math.max(dragState.minSplit, nextSplit)));
  };

  const handleSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = stackedResultRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const availableHeight = Math.max(rect.height - SPLITTER_HEIGHT, 1);
    const minSplit = Math.min(MIN_AGENT_PANEL_HEIGHT / availableHeight, 0.48);
    const maxSplit = Math.max(1 - MIN_RELATED_PANEL_HEIGHT / availableHeight, 0.52);

    splitDragRef.current = {
      pointerId: event.pointerId,
      top: rect.top,
      availableHeight,
      minSplit,
      maxSplit: Math.max(minSplit, maxSplit),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateStackedSplitFromPointer(event.clientY);
  };

  const handleSplitPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (splitDragRef.current?.pointerId !== event.pointerId) return;
    updateStackedSplitFromPointer(event.clientY);
  };

  const handleSplitPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (splitDragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    splitDragRef.current = null;
  };

  const handleSplitKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    if (event.key === 'Home') {
      setStackedSplit(0.34);
    } else if (event.key === 'End') {
      setStackedSplit(0.7);
    } else {
      setStackedSplit((current) => {
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        return Math.min(0.7, Math.max(0.34, current + direction * 0.04));
      });
    }
  };

  useEffect(() => {
    if (autoSearchStarted.current || !requestedQuery || !requestedMode) return;
    autoSearchStarted.current = true;
    if (requestedMode === 'keyword') {
      void runKeywordSearch(requestedQuery);
      return;
    }
    void runAiSearch(requestedQuery);
    // URL-driven search is intentionally executed once when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasSearchState = Boolean(result || loading || error || hasSearched);

  return (
    <div className="relative flex min-h-full flex-col overflow-visible py-1 md:h-full md:min-h-0 md:overflow-hidden md:py-3">
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!hasSearchState ? (
          <div className="flex flex-1 flex-col justify-center">
            <div className="mx-auto w-full max-w-5xl">
              <div className="px-4 text-center">
                <div className="inline-flex items-center gap-2 text-[32px] font-black tracking-tight text-slate-900 sm:text-[42px] md:text-[52px]">
                  <span>{searchType === 'keyword' ? '关键词检索' : 'AI 搜索'}</span>
                  {searchType === 'keyword' ? (
                    <SearchIcon className="h-7 w-7 text-[#55cfc7] md:h-8 md:w-8" />
                  ) : (
                    <Sparkles className="h-7 w-7 text-[#63dbe0] md:h-8 md:w-8" />
                  )}
                </div>
                <p className="mt-3 text-sm text-slate-500 md:text-base">
                  {searchType === 'keyword' ? '直接匹配文件名、描述、标签与已索引内容' : '用 AI 快速找到你需要的知识和答案'}
                </p>
                {currentFolderId ? <p className="mt-2 text-xs font-medium text-[#23999a]">当前限定：本目录及其全部子目录</p> : null}
              </div>

              <div className="mt-8 md:mt-10">
                <SearchComposer
                  mode="hero"
                  value={query}
                  loading={loading}
                  searchType={searchType}
                  error={error}
                  suggestions={searchType === 'ai' ? visibleSuggestions : []}
                  placeholder={searchType === 'keyword' ? '输入文件名、项目名或内容关键词，例如：项目报销' : '请输入问题、关键词或文件主题，例如：新人入职流程'}
                  onChange={setQuery}
                  onSearchTypeChange={handleSearchTypeChange}
                  onSubmit={(value) => void runAiSearch(value)}
                  onSuggestionClick={handleSuggestionClick}
                  onKeywordSearchClick={handleKeywordSearchClick}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-visible md:overflow-hidden">
              {searchType === 'keyword' ? (
                <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] w-full flex-col overflow-hidden pb-2 md:h-full md:min-h-0 md:pb-3">
                  <SearchFilePreviewPanel
                    files={relatedFiles}
                    loading={loading}
                    open
                    closable={false}
                    variant="keyword"
                    total={keywordMeta?.total}
                    elapsedMs={keywordMeta?.elapsed_ms}
                  />
                </div>
              ) : (
                <div
                  ref={stackedResultRef}
                  className="grid h-[calc(100dvh-9.5rem)] min-h-[620px] w-full overflow-hidden [grid-template-rows:minmax(220px,var(--agent-panel-size))_14px_minmax(260px,1fr)] md:h-full md:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(340px,31%)] xl:grid-rows-[minmax(0,1fr)] xl:gap-5"
                  style={{ '--agent-panel-size': `${stackedSplit * 100}%` } as React.CSSProperties}
                >
                  <div className="min-h-0 overflow-hidden xl:pr-1">
                    <div className="flex h-full min-h-0 flex-col pb-2 md:pb-3">
                      <AgentAnswerPanel
                        answer={result?.answer}
                        loading={loading}
                        error={error}
                        conversationId={result?.conversation_id}
                        debugTrace={result?.debug_trace}
                        relatedFiles={relatedFiles}
                        streamStatus={streamStatus}
                      />
                    </div>
                  </div>

                  <div
                    role="separator"
                    aria-label="调整智能推荐与相关文件区域高度"
                    aria-orientation="horizontal"
                    aria-valuemin={34}
                    aria-valuemax={70}
                    aria-valuenow={Math.round(stackedSplit * 100)}
                    tabIndex={0}
                    onPointerDown={handleSplitPointerDown}
                    onPointerMove={handleSplitPointerMove}
                    onPointerUp={handleSplitPointerEnd}
                    onPointerCancel={handleSplitPointerEnd}
                    onKeyDown={handleSplitKeyDown}
                    onDoubleClick={() => setStackedSplit(DEFAULT_STACKED_SPLIT)}
                    className="group relative flex cursor-row-resize touch-none items-center justify-center outline-none xl:hidden"
                    title="上下拖动调整区域高度，双击恢复默认"
                  >
                    <span className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-slate-200 transition-colors group-hover:bg-[#8bded5] group-focus-visible:bg-[#59c9bd]" />
                    <span className="relative flex h-6 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-300 shadow-[0_4px_12px_rgba(148,163,184,0.16)] transition group-hover:border-[#a6e5de] group-hover:text-[#38b8aa] group-focus-visible:border-[#67d2c7] group-focus-visible:text-[#269f94]">
                      <span className="h-1 w-6 rounded-full bg-current" />
                    </span>
                  </div>

                  <div className="flex min-h-0 flex-col overflow-hidden pb-2 md:pb-3">
                    <SearchFilePreviewPanel files={relatedFiles} loading={loading} open closable={false} />
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 z-20 mt-auto pb-1 pt-2">
              <div className="w-full">
                <SearchComposer
                  mode="inline"
                  value={query}
                  loading={loading}
                  searchType={searchType}
                  error={error}
                  placeholder={searchType === 'keyword' ? '继续筛选文件名、描述或内容关键词' : '继续追问，补充筛选条件或指定想看的文件'}
                  onChange={setQuery}
                  onSearchTypeChange={handleSearchTypeChange}
                  onSubmit={(value) => void runAiSearch(value)}
                  onKeywordSearchClick={handleKeywordSearchClick}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Search;
