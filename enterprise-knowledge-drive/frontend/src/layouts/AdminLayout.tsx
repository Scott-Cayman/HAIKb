import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Folder, BarChart3, Users, ArrowLeft, ShieldCheck, Settings, FileText, Sparkles, Menu, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

const AdminLayout = () => {
  const location = useLocation();
  const { user } = useAuthStore();
  const isSuperAdmin = !!user?.is_super_admin;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = useMemo(() => [
    { name: '仪表盘', icon: LayoutDashboard, path: '/admin', visible: true },
    { name: '文件夹管理', icon: Folder, path: '/admin/folders', visible: true },
    { name: '数据检测', icon: BarChart3, path: '/admin/usage-stats', visible: true },
    { name: '用户管理', icon: Users, path: '/admin/users', visible: isSuperAdmin },
    { name: '页面风格配置', icon: Settings, path: '/admin/appearance', visible: true },
    { name: '预设问题', icon: FileText, path: '/admin/preset-prompts', visible: true },
    { name: 'RAG 管理', icon: ShieldCheck, path: '/admin/rag', visible: true },
  ], [isSuperAdmin]);

  const isNavActive = (path: string) => {
    if (path === '/admin') return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobileNavOpen]);

  const currentPageName = navItems
    .filter((item) => item.visible && isNavActive(item.path))
    .sort((left, right) => right.path.length - left.path.length)[0]?.name || '系统后台';

  const navigation = (mobile = false) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex h-[76px] shrink-0 items-center border-b px-5 md:px-6">
        <div className="admin-brand-mark mr-3 flex h-10 w-10 items-center justify-center rounded-2xl">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-600">HAIKB</div>
          <div className="truncate text-lg font-bold tracking-tight text-slate-900">系统后台</div>
        </div>
        {mobile ? (
          <button type="button" onClick={() => setMobileNavOpen(false)} className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white/70 text-slate-500" aria-label="关闭后台导航">
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <nav className="relative min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-5 md:py-6">
        <div className="mb-4 flex items-center gap-2 pl-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          <Sparkles className="h-3.5 w-3.5 text-teal-500" />
          管理菜单
        </div>
        {navItems.filter((item) => item.visible).map((item) => {
          const isActive = isNavActive(item.path);
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`admin-nav-item group flex min-h-12 items-center rounded-2xl px-3.5 py-3 transition-all duration-200 ${
                isActive ? 'admin-nav-item-active font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span className={`mr-3 flex h-8 w-8 items-center justify-center rounded-xl transition ${isActive ? 'admin-nav-icon-active' : 'admin-nav-icon'}`}>
                <item.icon className="h-4 w-4" />
              </span>
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="relative shrink-0 border-t p-4">
        <Link to="/" className="admin-back-link group flex min-h-12 w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition-all">
          <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          返回前台
        </Link>
      </div>
    </div>
  );

  return (
    <div className="admin-shell flex h-[100dvh] overflow-hidden font-sans">
      <aside className="admin-sidebar relative z-10 hidden w-64 shrink-0 flex-col overflow-hidden border-r md:flex">
        <div className="admin-sidebar-orb admin-sidebar-orb-one" />
        <div className="admin-sidebar-orb admin-sidebar-orb-two" />
        {navigation()}
      </aside>

      <main className="admin-main relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="admin-main-glow admin-main-glow-mint" />
        <div className="admin-main-glow admin-main-glow-sky" />
        <div className="admin-main-glow admin-main-glow-warm" />
        <header className="relative z-[2] flex h-14 shrink-0 items-center border-b border-white/70 bg-white/76 px-3 backdrop-blur-xl md:hidden">
          <button type="button" onClick={() => setMobileNavOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eafaf7] text-teal-600" aria-label="打开后台导航">
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-3 min-w-0">
            <div className="truncate text-sm font-bold text-slate-900">{currentPageName}</div>
            <div className="text-[11px] text-slate-400">HAIKB 系统后台</div>
          </div>
        </header>
        <div className="admin-content-scroll relative z-[1] flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 xl:p-10">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </div>
      </main>

      <div className={`fixed inset-0 z-50 md:hidden ${mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!mobileNavOpen}>
        <button type="button" onClick={() => setMobileNavOpen(false)} className={`absolute inset-0 bg-slate-950/25 backdrop-blur-[2px] transition-opacity ${mobileNavOpen ? 'opacity-100' : 'opacity-0'}`} aria-label="关闭后台导航遮罩" />
        <aside className={`admin-sidebar absolute inset-y-0 left-0 w-[min(86vw,320px)] overflow-hidden border-r shadow-[24px_0_60px_rgba(15,23,42,0.18)] transition-transform duration-300 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {navigation(true)}
        </aside>
      </div>
    </div>
  );
};

export default AdminLayout;
