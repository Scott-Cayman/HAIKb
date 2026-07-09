import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { agentApi, AgentChatResponse, RelatedFileItem } from '../services/agentApi';
import api from '../services/api';
import SearchComposer from '../components/search/SearchComposer';
import { RelatedSearchFile } from '../components/search/RelatedFilesStrip';
import AgentAnswerPanel from '../components/search/AgentAnswerPanel';
import SearchFilePreviewPanel from '../components/search/SearchFilePreviewPanel';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';

const HERO_SUGGESTIONS = ['新人培训流程', '如何使用报销系统', '项目复盘模板', '公司制度有哪些'];
const SEARCH_PAGE_STORAGE_KEY = 'enterprise-knowledge-drive:ai-search-state';

type SearchPagePersistedState = {
  query: string;
  searchType: 'ai' | 'keyword';
  error: string | null;
  result: AgentChatResponse | null;
  relatedFiles: RelatedSearchFile[];
};

const loadSearchPageState = (): SearchPagePersistedState => {
  if (typeof window === 'undefined') {
    return {
      query: '',
      searchType: 'ai',
      error: null,
      result: null,
      relatedFiles: [],
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
      };
    }

    const parsed = JSON.parse(raw) as Partial<SearchPagePersistedState>;
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      searchType: parsed.searchType === 'keyword' ? 'keyword' : 'ai',
      error: typeof parsed.error === 'string' ? parsed.error : null,
      result: parsed.result ?? null,
      relatedFiles: Array.isArray(parsed.relatedFiles) ? parsed.relatedFiles : [],
    };
  } catch (error) {
    console.error('Failed to restore AI search state', error);
    return {
      query: '',
      searchType: 'ai',
      error: null,
      result: null,
      relatedFiles: [],
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
  const initialState = loadSearchPageState();
  const [query, setQuery] = useState<string>(initialState.query);
  const [searchType, setSearchType] = useState<'ai' | 'keyword'>(initialState.searchType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialState.error);
  const [result, setResult] = useState<AgentChatResponse | null>(initialState.result);
  const [relatedFiles, setRelatedFiles] = useState<RelatedSearchFile[]>(initialState.relatedFiles);
  const { loadFavoriteStatus } = useFavoriteStatus();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasPersistedState = Boolean(query || error || result || relatedFiles.length > 0);
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
    };
    window.sessionStorage.setItem(SEARCH_PAGE_STORAGE_KEY, JSON.stringify(stateToPersist));
  }, [error, query, relatedFiles, result, searchType]);

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

  const runSearch = async (nextQuery: string) => {
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) return;

    const conversationId = result?.conversation_id;
    setQuery(trimmedQuery);
    setLoading(true);
    setError(null);
    setResult(null);
    setRelatedFiles([]);

    try {
      const response = await agentApi.chat({
        query: trimmedQuery,
        conversation_id: conversationId,
        top_k: 8,
        retrieval_mode: 'hybrid',
      });
      setResult(response);
      setRelatedFiles(toDisplayFiles(response.related_files || []));
    } catch (err: any) {
      if (err?.code === 'ECONNABORTED') {
        setError('AI 检索超时，请稍后重试');
      } else {
        setError(err?.response?.data?.detail || err?.message || 'AI 检索失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (value: string) => {
    setQuery(value);
    void runSearch(value);
  };

  const handleKeywordSearchClick = (value: string) => {
    if (!value.trim()) return;
    void runSearch(value);
  };

  const hasSearchState = Boolean(result || loading || error);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden py-2 md:py-3">
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!hasSearchState ? (
          <div className="flex flex-1 flex-col justify-center">
            <div className="mx-auto w-full max-w-5xl">
              <div className="px-4 text-center">
                <div className="inline-flex items-center gap-2 text-[42px] font-black tracking-tight text-slate-900 md:text-[52px]">
                  <span>AI 搜索</span>
                  <Sparkles className="h-7 w-7 text-[#63dbe0] md:h-8 md:w-8" />
                </div>
                <p className="mt-3 text-sm text-slate-500 md:text-base">用 AI 快速找到你需要的知识和答案</p>
              </div>

              <div className="mt-8 md:mt-10">
                <SearchComposer
                  mode="hero"
                  value={query}
                  loading={loading}
                  searchType={searchType}
                  error={error}
                  suggestions={HERO_SUGGESTIONS}
                  placeholder="请输入问题、关键词或文件主题，例如：新人入职流程"
                  onChange={setQuery}
                  onSearchTypeChange={setSearchType}
                  onSubmit={(value) => void runSearch(value)}
                  onSuggestionClick={handleSuggestionClick}
                  onKeywordSearchClick={handleKeywordSearchClick}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="grid h-full w-full gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,31%)]">
                <div className="min-h-0 overflow-hidden pr-1">
                  <div className="flex h-full min-h-0 flex-col pb-2 md:pb-3">
                    <AgentAnswerPanel
                      answer={result?.answer}
                      loading={loading}
                      error={error}
                      conversationId={result?.conversation_id}
                    />
                  </div>
                </div>
                <div className="flex h-full min-h-0 flex-col overflow-hidden pb-2 md:pb-3">
                  <SearchFilePreviewPanel files={relatedFiles} loading={loading} open closable={false} />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-20 mt-auto pb-1 pt-2">
              <div className="w-full">
                <SearchComposer
                  mode="inline"
                  value={query}
                  loading={loading}
                  searchType={searchType}
                  error={error}
                  placeholder="继续追问，补充筛选条件或指定想看的文件"
                  onChange={setQuery}
                  onSearchTypeChange={setSearchType}
                  onSubmit={(value) => void runSearch(value)}
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
