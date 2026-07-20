import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Users, Folder, File as FileIcon, Activity, CheckCircle2, RefreshCw } from 'lucide-react';

const AdminDashboard = () => {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await api.get('/admin/dashboard');
        setStats(response.data);
      } catch (error) {
        console.error('Failed to fetch dashboard', error);
      }
    };
    fetchDashboard();
  }, []);

  if (!stats) {
    return (
      <div className="admin-panel flex min-h-64 items-center justify-center rounded-[28px]">
        <RefreshCw className="mr-3 h-5 w-5 animate-spin text-teal-500" />
        <span className="text-sm font-medium text-slate-500">正在汇总运行数据...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-teal-600">Overview</div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">仪表盘</h1>
          <p className="mt-2 text-sm text-slate-500">系统整体运行概况与资源统计</p>
        </div>
        <div className="admin-status-pill inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          服务运行正常
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card admin-stat-sky group">
          <div className="admin-stat-shine" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-500">总用户数</h3>
              <p className="mt-1 text-xs text-slate-400">已接入平台账号</p>
            </div>
            <div className="admin-stat-icon"><Users className="h-5 w-5" /></div>
          </div>
          <p className="relative mt-7 text-4xl font-bold tracking-tight text-slate-900">{stats.users_count}</p>
        </div>

        <div className="admin-stat-card admin-stat-mint group">
          <div className="admin-stat-shine" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-500">总文件夹</h3>
              <p className="mt-1 text-xs text-slate-400">知识目录节点</p>
            </div>
            <div className="admin-stat-icon"><Folder className="h-5 w-5" /></div>
          </div>
          <p className="relative mt-7 text-4xl font-bold tracking-tight text-slate-900">{stats.folders_count}</p>
        </div>

        <div className="admin-stat-card admin-stat-aqua group">
          <div className="admin-stat-shine" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-500">总文件数</h3>
              <p className="mt-1 text-xs text-slate-400">已沉淀知识资产</p>
            </div>
            <div className="admin-stat-icon"><FileIcon className="h-5 w-5" /></div>
          </div>
          <p className="relative mt-7 text-4xl font-bold tracking-tight text-slate-900">{stats.files_count}</p>
        </div>

        <div className="admin-stat-card admin-stat-warm group">
          <div className="admin-stat-shine" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-500">系统状态</h3>
              <p className="mt-1 text-xs text-slate-400">实时健康检测</p>
            </div>
            <div className="admin-stat-icon"><Activity className="h-5 w-5" /></div>
          </div>
          <p className="relative mt-7 flex items-center gap-2 text-2xl font-bold text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />运行良好
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
