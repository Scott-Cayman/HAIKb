import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, ChevronRight, Download, Eye, FileText, Loader2, Search as SearchIcon } from 'lucide-react';

import { agentApi, AgentChatResponse } from '../services/agentApi';
import { BACKEND_BASE_URL } from '../services/backendConfig';

const STORAGE_KEY = 'search_page_state';

const Search = () => {
  const navigate = useNavigate();
  
  const [query, setQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentChatResponse | null>(null);

  useEffect(() => {
    const savedState = localStorage.getItem(STORAGE_KEY);
    if (savedState) {
      try {
        const { query: savedQuery, result: savedResult, error: savedError } = JSON.parse(savedState);
        setTimeout(() => {
          if (savedQuery && typeof savedQuery === 'string') setQuery(savedQuery);
          if (savedResult && typeof savedResult === 'object' && 'answer' in savedResult) {
            setResult(savedResult);
          }
          if (savedError && typeof savedError === 'string') setError(savedError);
        }, 0);
      } catch (e) {
        console.error('Failed to restore search state:', e);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    const stateToSave = { query, result, error };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  }, [query, result, error]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await agentApi.chat({ query, top_k: 8, retrieval_mode: 'hybrid' });
      setResult(response);
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

  const renderAnswer = () => {
    if (!result) return null;
    return (
      <article className="prose prose-slate max-w-none text-sm leading-7">
        {result.answer.split('\n').map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </article>
    );
  };

  const renderRelatedFiles = () => {
    const validFiles = result?.related_files?.filter((file) => file.score > 0) || [];
    if (validFiles.length === 0) {
      return <p className="text-sm text-slate-500">暂无推荐文件。</p>;
    }
    return (
      <div className="space-y-4">
        {validFiles.map((file) => (
          <div 
            key={`file-${file.file_id}-${file.summary_id}`} 
            className="border border-slate-200 rounded-2xl p-5 hover:border-blue-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-slate-900 font-semibold">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <span className="truncate">{file.original_name}</span>
                </div>
                <p className="text-sm text-slate-600 mt-3 leading-7">{file.one_line_judgement}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-slate-400">匹配分数</div>
                <div className="text-lg font-bold text-blue-600">{file.score.toFixed(2)}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <button
                onClick={() => navigate(`/files/${file.file_id}`)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm"
              >
                <Eye className="w-4 h-4" />
                预览原文件
              </button>
              <a
                href={`${BACKEND_BASE_URL}${file.download_url}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors text-sm"
              >
                <Download className="w-4 h-4" />
                下载原文件
              </a>
              <button
                onClick={() => navigate(`/files/${file.file_id}`)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:border-slate-300 transition-colors text-sm"
              >
                查看 AI 总结
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">AI 检索与 Agent 问答</h1>
            <p className="text-sm text-slate-500 mt-1">只基于 AI 总结文档做 RAG，不直接读取原文件全文。</p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <SearchIcon className="w-5 h-5 text-slate-400 absolute left-4 top-4" />
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              rows={4}
              placeholder="例如：找文旅类标书、找活动执行案例、找有评分标准的政府项目"
              className="w-full rounded-2xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition-all pl-12 pr-4 py-3 text-sm resize-none"
            />
          </div>
          <div className="lg:w-48 flex lg:flex-col gap-3">
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
              开始检索
            </button>
            <button
              onClick={() => {
                setResult(null);
                setError(null);
                localStorage.removeItem(STORAGE_KEY);
              }}
              className="px-5 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
            >
              清空结果
            </button>
          </div>
        </div>
        {error ? <p className="text-sm text-red-500 mt-4">{error}</p> : null}
      </section>

      <div className="space-y-6">
        <section className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6 min-h-[220px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900">Agent 回答</h2>
            {result?.conversation_id ? (
              <span className="text-xs text-slate-400">会话 ID: {result.conversation_id.slice(0, 8)}</span>
            ) : null}
          </div>
          {loading ? (
            <div className="flex items-center gap-3 text-slate-500 py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>AI 正在根据总结文档组织答案...</span>
            </div>
          ) : result ? (
            renderAnswer()
          ) : (
            <p className="text-slate-500 text-sm">输入问题后，这里会展示匹配结论、推荐文件和注意事项。</p>
          )}
        </section>

        <section className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900">推荐文件</h2>
            <span className="text-xs text-slate-400">AI评分 (0.0-1.0，越接近1越相关)</span>
          </div>
          {renderRelatedFiles()}
        </section>
      </div>
    </div>
  );
};

export default Search;
