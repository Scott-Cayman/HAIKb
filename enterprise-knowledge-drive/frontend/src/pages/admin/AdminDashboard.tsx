import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Users, Folder, File as FileIcon, Activity } from 'lucide-react';

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

  if (!stats) return <div className="text-slate-400">Loading...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">仪表盘</h1>
        <p className="text-slate-400 mt-2 text-sm">系统整体运行概况</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-400 font-medium">总用户数</h3>
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <p className="text-4xl font-bold text-white">{stats.users_count}</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-400 font-medium">总文件夹</h3>
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <Folder className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <p className="text-4xl font-bold text-white">{stats.folders_count}</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-400 font-medium">总文件数</h3>
            <div className="p-2 bg-indigo-500/20 rounded-lg">
              <FileIcon className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <p className="text-4xl font-bold text-white">{stats.files_count}</p>
        </div>

        <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-400 font-medium">系统状态</h3>
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <Activity className="w-5 h-5 text-amber-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-emerald-400">运行良好</p>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
