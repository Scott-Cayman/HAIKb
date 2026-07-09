import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Folder, BarChart3, Users, ArrowLeft, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

const AdminLayout = () => {
  const location = useLocation();
  const { user } = useAuthStore();
  const isSuperAdmin = !!user?.is_super_admin;

  const navItems = [
    { name: '仪表盘', icon: LayoutDashboard, path: '/admin', visible: true },
    { name: '文件夹管理', icon: Folder, path: '/admin/folders', visible: true },
    { name: '数据检测', icon: BarChart3, path: '/admin/usage-stats', visible: true },
    { name: '用户管理', icon: Users, path: '/admin/users', visible: isSuperAdmin },
    { name: 'RAG 管理', icon: ShieldAlert, path: '/admin/rag', visible: true },
  ];

  return (
    <div className="flex h-screen bg-slate-900 font-sans text-slate-100">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col shadow-xl z-10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
        <div className="h-16 flex items-center px-6 border-b border-slate-800">
          <div className="w-8 h-8 bg-indigo-500/20 border border-indigo-500/50 rounded flex items-center justify-center mr-3 shadow-inner">
            <ShieldAlert className="w-4 h-4 text-indigo-400" />
          </div>
          <span className="font-bold text-lg tracking-tight text-white">系统后台</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          <div className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-widest pl-2">管理菜单</div>
          {navItems.filter(item => item.visible).map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center px-3 py-2.5 rounded transition-all duration-200 ${
                  isActive 
                    ? 'bg-indigo-500/10 text-indigo-400 font-medium border-l-2 border-indigo-500' 
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border-l-2 border-transparent'
                }`}
              >
                <item.icon className={`w-4 h-4 mr-3 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <Link
            to="/"
            className="flex items-center justify-center px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors w-full text-sm font-medium border border-slate-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2 text-slate-400" />
            返回前台
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative bg-slate-900">
        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
