import { useState, useEffect } from 'react';
import { BarChart3, Loader2, Calendar, User, FileText, Clock } from 'lucide-react';
import api from '../../services/api';

interface UserUsageStats {
  id: number;
  name: string;
  department_name: string | null;
  file_view_count: number;
  agent_chat_count: number;
  last_active: string | null;
}

interface UsageStatsResponse {
  users: UserUsageStats[];
  total_users: number;
}

const UsageStats = () => {
  const [timeRange, setTimeRange] = useState<string>('all');
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async (range: string) => {
    try {
      setLoading(true);
      const response = await api.get('/admin/usage-stats', { params: { time_range: range } });
      setStats(response.data);
    } catch (error) {
      console.error('获取数据统计失败', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(timeRange);
  }, [timeRange]);

  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTimeRangeLabel = (range: string) => {
    switch (range) {
      case '7d': return '最近7天';
      case '30d': return '最近30天';
      default: return '全部时间';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-indigo-400" />
            数据检测
          </h1>
          <p className="text-slate-400 mt-2">查看部门成员的文件浏览和AI检索使用情况</p>
        </div>
      </div>

      {/* 时间筛选 */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-lg p-6 mb-6">
        <div className="flex items-center gap-4">
          <Calendar className="w-5 h-5 text-slate-400" />
          <span className="text-slate-300 font-medium">时间范围:</span>
          <div className="flex gap-2">
            {['all', '7d', '30d'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  timeRange === range
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {getTimeRangeLabel(range)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 统计概览 */}
      {!loading && stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-lg p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-600/20 rounded-lg flex items-center justify-center">
                <User className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">统计用户</p>
                <p className="text-2xl font-bold text-white">{stats.total_users}</p>
              </div>
            </div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-lg p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-green-600/20 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">总文件浏览</p>
                <p className="text-2xl font-bold text-white">
                  {stats.users.reduce((sum, user) => sum + user.file_view_count, 0)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-lg p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-purple-600/20 rounded-lg flex items-center justify-center">
                <span className="text-purple-400 font-bold text-lg tracking-tight">AI</span>
              </div>
              <div>
                <p className="text-slate-400 text-sm">总AI检索</p>
                <p className="text-2xl font-bold text-white">
                  {stats.users.reduce((sum, user) => sum + user.agent_chat_count, 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 用户列表 */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <span className="ml-3 text-slate-400">加载数据中...</span>
          </div>
        ) : stats && stats.users.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-750">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      排名
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      用户
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      部门
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      文件浏览
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      AI检索
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      最后活跃
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {stats.users.map((user, index) => (
                    <tr key={user.id} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                            index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                            index === 1 ? 'bg-slate-400/20 text-slate-300' :
                            index === 2 ? 'bg-orange-500/20 text-orange-400' :
                            'bg-slate-700 text-slate-400'
                          }`}>
                            {index + 1}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center mr-3">
                            <User className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{user.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-300">{user.department_name || '-'}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-500/10 text-green-400">
                          <FileText className="w-4 h-4 mr-1.5" />
                          {user.file_view_count}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-500/10 text-purple-400">
                          <span className="font-bold text-xs mr-1.5">AI</span>
                          {user.agent_chat_count}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-slate-300">
                          <Clock className="w-4 h-4 mr-1.5 text-slate-500" />
                          {formatTime(user.last_active)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16">
            <User className="w-16 h-16 text-slate-600 mb-4" />
            <p className="text-slate-400">暂无用户数据</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UsageStats;
