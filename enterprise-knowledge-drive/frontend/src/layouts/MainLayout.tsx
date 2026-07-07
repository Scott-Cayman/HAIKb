import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, User } from '../stores/authStore';
import { Search, Folder, Clock, Star, Settings, LogOut, Cloud } from 'lucide-react';

// 从完整部门路径中提取二级部门
const getSecondLevelDepartment = (user: User): string => {
  if (!user.full_department_path) {
    return user.department_name || '成员';
  }
  
  const parts = user.full_department_path.split('/');
  
  if (parts.length >= 2) {
    return parts[1];
  }
  
  return user.department_name || '成员';
};

const MainLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'AI 检索', icon: Search, path: '/search' },
    { name: '知识库', icon: Folder, path: '/' },
    { name: '最近访问', icon: Clock, path: '/recent' },
    { name: '我的收藏', icon: Star, path: '/favorites' },
  ];

  return (
    <div className="min-h-screen bg-transparent px-5 py-5 font-sans text-slate-800">
      <div className="flex min-h-[calc(100vh-2.5rem)] rounded-[32px] border border-white/70 bg-white/45 shadow-[0_22px_60px_rgba(149,167,194,0.12)] backdrop-blur-xl">
      {/* Sidebar */}
      <aside className="flex w-[264px] flex-col rounded-l-[32px] border-r border-white/70 bg-white/65 px-4 py-5 shadow-sm z-10">
        <div className="mb-6 flex items-center px-3">
          <div className="mr-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#79f2df] via-[#5ee7d6] to-[#8eb8ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_14px_30px_rgba(123,223,211,0.35)]">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight text-slate-900">知识云盘</div>
            <div className="text-xs text-slate-400">企业资料协作中心</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
          <div className="mb-4 pl-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">企业门户</div>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center rounded-2xl px-4 py-3 transition-all duration-200 ${
                  isActive 
                    ? 'bg-gradient-to-r from-[#ffffff] to-[#eefcf8] text-slate-900 font-semibold shadow-[0_12px_24px_rgba(170,232,220,0.24)]' 
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                <span className={`mr-3 flex h-9 w-9 items-center justify-center rounded-xl ${
                  isActive ? 'bg-gradient-to-br from-[#75eedb] to-[#9ab6ff] shadow-[0_10px_20px_rgba(125,214,220,0.3)]' : 'bg-slate-100/80'
                }`}>
                  <item.icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                </span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 rounded-[28px] border border-white/80 bg-white/75 p-3 shadow-[0_14px_30px_rgba(194,211,233,0.18)]">
          <div className="mb-2 flex items-center rounded-2xl px-2 py-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#dde9ff] to-[#bff5e8] text-sm font-bold text-slate-700">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="ml-3 flex-1 overflow-hidden">
              <p className="text-sm font-medium text-slate-900 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user ? getSecondLevelDepartment(user) : '成员'}</p>
            </div>
          </div>
          
          {user?.is_admin && (
            <Link
              to="/admin"
              className="flex items-center rounded-2xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Settings className="w-4 h-4 mr-3 text-slate-400" />
              后台管理
            </Link>
          )}
          
          <button
            onClick={handleLogout}
            className="flex w-full items-center rounded-2xl px-3 py-2.5 text-left text-sm text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="w-4 h-4 mr-3 text-slate-400 group-hover:text-red-500" />
            退出登录
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Page Content */}
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-[1240px]">
            <Outlet />
          </div>
        </div>
      </main>
      </div>
    </div>
  );
};

export default MainLayout;
