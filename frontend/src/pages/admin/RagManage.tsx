import { useEffect, useState } from 'react';
import { Database, Loader2, RefreshCcw, Search } from 'lucide-react';

import { ragApi, RagIndexItem, RagStatusResponse } from '../../services/ragApi';

const RagManage = () => {
  const [indices, setIndices] = useState<RagIndexItem[]>([]);
  const [status, setStatus] = useState<RagStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [indicesData, statusData] = await Promise.all([ragApi.getIndices(), ragApi.getStatus()]);
      setIndices(indicesData);
      setStatus(statusData);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '获取 RAG 管理数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      await ragApi.rebuildDefaultIndex();
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.detail || '重建索引失败');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">RAG 管理</h1>
        <p className="text-slate-400 mt-2 text-sm">管理总结文档索引、切片数量和检索状态。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400">总结文档数</span>
            <Database className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="text-3xl font-bold text-white">{status?.total_summaries ?? '-'}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400">Source 数量</span>
            <Search className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-white">{status?.total_sources ?? '-'}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400">Chunk 数量</span>
            <RefreshCcw className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-3xl font-bold text-white">{status?.total_chunks ?? '-'}</div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">索引列表</h2>
            <p className="text-sm text-slate-400 mt-1">默认使用 HAIKb Summary RAG Index。</p>
          </div>
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white transition-colors disabled:opacity-60"
          >
            {rebuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            重建默认索引
          </button>
        </div>

        {error ? <p className="text-sm text-red-400 mb-4">{error}</p> : null}

        {loading ? (
          <div className="flex items-center gap-3 text-slate-300">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>加载 RAG 状态中...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="py-3 font-medium">名称</th>
                  <th className="py-3 font-medium">类型</th>
                  <th className="py-3 font-medium">状态</th>
                  <th className="py-3 font-medium">总结文档</th>
                  <th className="py-3 font-medium">切片数</th>
                </tr>
              </thead>
              <tbody>
                {indices.map((item) => (
                  <tr key={item.id} className="border-b border-slate-800 text-slate-200">
                    <td className="py-4 pr-4">{item.name}</td>
                    <td className="py-4 pr-4">{item.index_type}</td>
                    <td className="py-4 pr-4">{item.status}</td>
                    <td className="py-4 pr-4">{item.summary_count}</td>
                    <td className="py-4 pr-4">{item.chunk_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default RagManage;
