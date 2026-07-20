import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, type User } from '../stores/authStore';
import { Search, Folder, Clock, Star, Settings, LogOut, Cloud, Menu, X } from 'lucide-react';
import { getTestDepartmentScope, subscribeTestDepartmentScope } from '../services/testDepartmentScope';

const getSecondLevelDepartment = (user: User): string => {
  if (!user.full_department_path) return user.department_name || '成员';
  const parts = user.full_department_path.split('/');
  return parts.length >= 2 ? parts[1] : user.department_name || '成员';
};

const navItems = [
  { name: 'AI 检索', icon: Search, path: '/search' },
  { name: '知识库', icon: Folder, path: '/' },
  { name: '最近访问', icon: Clock, path: '/recent' },
  { name: '我的收藏', icon: Star, path: '/favorites' },
];

type NavigationPanelProps = {
  user: User | null;
  pathname: string;
  testDepartmentScope: string | null;
  mobile?: boolean;
  onClose?: () => void;
  onLogout: () => void;
};

const NavigationPanel = ({ user, pathname, testDepartmentScope, mobile = false, onClose, onLogout }: NavigationPanelProps) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="mb-5 flex items-center px-3">
      <div className="mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#79f2df] via-[#5ee7d6] to-[#8eb8ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_14px_30px_rgba(123,223,211,0.35)]">
        <Cloud className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-bold tracking-tight text-slate-900">HAIKB</div>
        <div className="truncate text-xs text-slate-400">企业AI知识云盘</div>
      </div>
      {mobile ? (
        <button type="button" onClick={onClose} className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500" aria-label="关闭导航">
          <X className="h-5 w-5" />
        </button>
      ) : null}
    </div>

    <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
      {navItems.map((item) => {
        const isKnowledgeRoute = item.path === '/' && (pathname === '/' || pathname.startsWith('/folders/') || pathname.startsWith('/files/'));
        const isActive = isKnowledgeRoute || (item.path !== '/' && pathname === item.path);
        return (
          <Link
            key={item.name}
            to={item.path}
            onClick={onClose}
            className={`flex min-h-12 items-center rounded-2xl px-3 py-2.5 transition-all duration-200 ${
              isActive
                ? 'bg-gradient-to-r from-white to-[#eefcf8] font-semibold text-slate-900 shadow-[0_12px_24px_rgba(170,232,220,0.24)]'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            <span className={`mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-gradient-to-br from-[#75eedb] to-[#9ab6ff] shadow-[0_10px_20px_rgba(125,214,220,0.3)]' : 'bg-slate-100/80'}`}>
              <item.icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
            </span>
            {item.name}
          </Link>
        );
      })}
    </nav>

    <div className="mt-3 rounded-[24px] border border-white/80 bg-white/80 p-3 shadow-[0_14px_30px_rgba(194,211,233,0.18)]">
      <div className="mb-2 flex items-center rounded-2xl px-2 py-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#dde9ff] to-[#bff5e8] text-sm font-bold text-slate-700">
          {user?.name?.charAt(0) || 'U'}
        </div>
        <div className="ml-3 min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
          <p className="truncate text-xs text-slate-500">{user ? getSecondLevelDepartment(user) : '成员'}</p>
          {testDepartmentScope ? <p className="mt-1 truncate text-[11px] text-indigo-500">测试作用域：{testDepartmentScope}</p> : null}
        </div>
      </div>

      {user?.is_admin ? (
        <Link to="/admin" onClick={onClose} className="flex min-h-11 items-center rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50">
          <Settings className="mr-3 h-4 w-4 text-slate-400" />
          后台管理
        </Link>
      ) : null}

      <button onClick={onLogout} className="flex min-h-11 w-full items-center rounded-2xl px-3 py-2.5 text-left text-sm text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600">
        <LogOut className="mr-3 h-4 w-4 text-slate-400" />
        退出登录
      </button>
    </div>
  </div>
);

const MainLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [testDepartmentScope, setTestDepartmentScope] = useState<string | null>(getTestDepartmentScope());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => subscribeTestDepartmentScope(setTestDepartmentScope), []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileNavOpen]);

  const currentPageName = useMemo(() => {
    if (location.pathname === '/search') return 'AI 检索';
    if (location.pathname === '/recent') return '最近访问';
    if (location.pathname === '/favorites') return '我的收藏';
    return '知识库';
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-transparent p-0 font-sans text-slate-800 md:px-4 md:py-4 xl:px-5 xl:py-5">
      <div className="flex h-full overflow-hidden border-white/70 bg-white/40 backdrop-blur-xl md:h-[calc(100dvh-2rem)] md:rounded-[28px] md:border md:shadow-[0_18px_48px_rgba(149,167,194,0.1)] xl:h-[calc(100dvh-2.5rem)] xl:rounded-[32px]">
        <aside className="z-10 hidden h-full w-[236px] shrink-0 flex-col rounded-l-[28px] border-r border-white/70 bg-white/62 px-4 py-5 shadow-sm md:flex xl:w-[248px] xl:rounded-l-[32px]">
          <NavigationPanel user={user} pathname={location.pathname} testDepartmentScope={testDepartmentScope} onLogout={handleLogout} />
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center border-b border-white/80 bg-white/80 px-3 backdrop-blur-xl md:hidden">
            <button type="button" onClick={() => setMobileNavOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#effaf7] text-[#229d91]" aria-label="打开导航">
              <Menu className="h-5 w-5" />
            </button>
            <div className="ml-3 min-w-0">
              <div className="truncate text-sm font-bold text-slate-900">{currentPageName}</div>
              <div className="truncate text-[11px] text-slate-400">HAIKB 企业知识云盘</div>
            </div>
            <div className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#dde9ff] to-[#bff5e8] text-xs font-bold text-slate-700">
              {user?.name?.charAt(0) || 'U'}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-5 md:py-6 xl:px-7 xl:py-7">
            <div className="h-full min-h-0 w-full">
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      <div className={`fixed inset-0 z-50 md:hidden ${mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!mobileNavOpen}>
        <button type="button" onClick={() => setMobileNavOpen(false)} className={`absolute inset-0 bg-slate-950/25 backdrop-blur-[2px] transition-opacity ${mobileNavOpen ? 'opacity-100' : 'opacity-0'}`} aria-label="关闭导航遮罩" />
        <aside className={`absolute inset-y-0 left-0 w-[min(86vw,320px)] border-r border-white/80 bg-[#f7fcfd]/96 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-[24px_0_60px_rgba(15,23,42,0.16)] backdrop-blur-xl transition-transform duration-300 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <NavigationPanel user={user} pathname={location.pathname} testDepartmentScope={testDepartmentScope} mobile onClose={() => setMobileNavOpen(false)} onLogout={handleLogout} />
        </aside>
      </div>
    </div>
  );
};

export default MainLayout;
