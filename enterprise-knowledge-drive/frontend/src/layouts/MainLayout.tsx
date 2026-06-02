import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Search, Folder, Clock, Star, Settings, LogOut, Cloud } from 'lucide-react';
import api from '../services/api';

type TitleSearchItem = {
  id: number;
  title: string;
  kind: 'file' | 'folder';
  hit_count: number;
};

const MainLayout = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const headerSearchRef = useRef<HTMLDivElement | null>(null);

  const [keyword, setKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<TitleSearchItem[]>([]);

  const normalizedKeyword = useMemo(() => keyword.replace(/\s+/g, ''), [keyword]);
  const canSearch = normalizedKeyword.length >= 2;

  const folderResults = useMemo(() => searchResults.filter((item) => item.kind === 'folder'), [searchResults]);
  const fileResults = useMemo(() => searchResults.filter((item) => item.kind === 'file'), [searchResults]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const runTitleSearch = async () => {
    setSearchError(null);
    setSearchOpen(true);

    if (!canSearch) {
      setSearchResults([]);
      if (normalizedKeyword.length > 0) {
        setSearchError('请输入至少两个连续字再检索标题');
      }
      return;
    }

    setSearchLoading(true);
    try {
      const response = await api.get<{ results: TitleSearchItem[] }>('/files/title-search', {
        params: {
          q: keyword,
          limit: 16,
        },
      });
      setSearchResults(response.data?.results || []);
    } catch (err: any) {
      setSearchResults([]);
      setSearchError(err?.response?.data?.detail || err?.message || '关键词检索失败');
    } finally {
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const node = headerSearchRef.current;
      if (!node) return;
      if (node.contains(event.target as Node)) return;
      setSearchOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const navItems = [
    { name: '公司资料', icon: Folder, path: '/' },
    { name: 'AI 检索', icon: Search, path: '/search' },
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
              <p className="text-xs text-slate-500 truncate">{user?.department_name || '成员'}</p>
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
        {/* Header */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex-1 max-w-2xl">
            <div ref={headerSearchRef} className="relative group">
              <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
              <input
                type="text"
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  if (!event.target.value.trim()) {
                    setSearchResults([]);
                    setSearchError(null);
                    setSearchOpen(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    runTitleSearch();
                  }
                }}
                placeholder="关键词检索（仅检索标题，至少两个连续字才显示）"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border-transparent focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl text-sm transition-all outline-none"
              />

              {searchOpen ? (
                <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden z-20">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div className="text-xs text-slate-500">
                      {searchLoading ? '检索中...' : canSearch ? '标题匹配结果' : '请输入至少两个连续字'}
                    </div>
                    <button
                      onClick={() => setSearchOpen(false)}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      关闭
                    </button>
                  </div>

                  {searchError ? <div className="px-4 py-3 text-sm text-red-500">{searchError}</div> : null}

                  {!searchLoading && !searchError && canSearch && folderResults.length === 0 && fileResults.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-slate-500">没有匹配到任何文件或文件夹标题。</div>
                  ) : null}

                  <div className="max-h-[360px] overflow-y-auto">
                    {folderResults.length ? (
                      <div className="px-4 py-3 border-t border-slate-50">
                        <div className="text-xs text-slate-400 mb-2">文件夹</div>
                        <div className="space-y-1">
                          {folderResults.map((item) => (
                            <button
                              key={`folder-${item.id}`}
                              onClick={() => {
                                setSearchOpen(false);
                                navigate(`/folders/${item.id}`);
                              }}
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-between"
                            >
                              <span className="text-sm text-slate-700 truncate">{item.title}</span>
                              <span className="text-xs text-slate-400 ml-3 shrink-0">{item.hit_count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {fileResults.length ? (
                      <div className="px-4 py-3 border-t border-slate-50">
                        <div className="text-xs text-slate-400 mb-2">文件</div>
                        <div className="space-y-1">
                          {fileResults.map((item) => (
                            <button
                              key={`file-${item.id}`}
                              onClick={() => {
                                setSearchOpen(false);
                                navigate(`/files/${item.id}`);
                              }}
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-between"
                            >
                              <span className="text-sm text-slate-700 truncate">{item.title}</span>
                              <span className="text-xs text-slate-400 ml-3 shrink-0">{item.hit_count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          
          <div className="flex items-center ml-4 space-x-4">
            <button
              onClick={runTitleSearch}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all disabled:opacity-60"
              disabled={searchLoading || !keyword.trim()}
            >
              关键词检索
            </button>
          </div>
        </header>

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
