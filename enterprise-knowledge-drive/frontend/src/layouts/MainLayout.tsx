import { useEffect, useMemo, useRef, useState } from 'react';
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
    <div className="flex h-screen bg-[#f7f8f9] font-sans text-slate-800">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm z-10">
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3 shadow-inner">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">知识云盘</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          <div className="text-xs font-semibold text-slate-400 mb-4 uppercase tracking-wider pl-2">企业门户</div>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 ${
                  isActive 
                    ? 'bg-blue-50 text-blue-700 font-medium' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon className={`w-5 h-5 mr-3 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
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
              className="flex items-center px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Settings className="w-4 h-4 mr-3 text-slate-400" />
              后台管理
            </Link>
          )}
          
          <button
            onClick={handleLogout}
            className="flex items-center px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors w-full text-left"
          >
            <LogOut className="w-4 h-4 mr-3 text-slate-400 group-hover:text-red-500" />
            退出登录
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
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

export default MainLayout;
