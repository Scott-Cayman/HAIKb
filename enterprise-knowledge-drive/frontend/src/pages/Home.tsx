import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';

import { useAuthStore } from '../stores/authStore';
import { defaultHomeAppearance, gradientToCss, type HomeAppearanceConfig } from '../config/homeAppearance';
import { getHomeAppearanceConfig } from '../services/homeAppearance';
import {
  getHomeFolderContext,
  updateHomePinnedFolders,
  type HomeFolderContext,
} from '../services/homeFolders';
import HomePinnedFoldersSection from '../components/home/HomePinnedFoldersSection';
import HomeCloudDriveSection from '../components/home/HomeCloudDriveSection';
import api from '../services/api';

type TitleSearchItem = {
  id: number;
  title: string;
  kind: 'file' | 'folder';
  hit_count: number;
};

const Home = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canCreateFolder = !!user?.is_admin || !!user?.is_super_admin;
  const [appearanceConfig, setAppearanceConfig] = useState<HomeAppearanceConfig>(defaultHomeAppearance);
  const [context, setContext] = useState<HomeFolderContext | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<TitleSearchItem[]>([]);
  const headerSearchRef = useRef<HTMLDivElement | null>(null);

  const normalizedKeyword = keyword.replace(/\s+/g, '');
  const canSearch = normalizedKeyword.length >= 2;
  const folderResults = searchResults.filter((item) => item.kind === 'folder');
  const fileResults = searchResults.filter((item) => item.kind === 'file');
  const aiButtonStyle = {
    backgroundImage: gradientToCss(appearanceConfig.aiButton),
    color: appearanceConfig.aiButton.text,
  };
  const keywordButtonStyle = {
    backgroundColor: appearanceConfig.keywordButton.bg,
    color: appearanceConfig.keywordButton.text,
  };

  const loadHomeContext = async () => {
    const nextContext = await getHomeFolderContext();
    setContext(nextContext);
    setActiveFolderId((prev) => prev ?? nextContext.center_folder.id);
  };

  useEffect(() => {
    let cancelled = false;

    const loadPage = async () => {
      try {
        const [{ config }, homeContext] = await Promise.all([
          getHomeAppearanceConfig(),
          getHomeFolderContext(),
        ]);
        if (cancelled) return;
        setAppearanceConfig(config);
        setContext(homeContext);
        setActiveFolderId(homeContext.center_folder.id);
      } catch (error) {
        console.error('Failed to load home page', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPage();

    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleSavePinnedFolders = async (folderIds: number[]) => {
    if (!context) return;
    const nextContext = await updateHomePinnedFolders(context.center_folder.id, folderIds);
    setContext(nextContext);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">首页加载中...</div>;
  }

  if (!context || activeFolderId === null) {
    return <div className="p-8 text-center text-slate-500">未找到当前部门对应的知识库目录</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 pb-2">
      <section className="shrink-0 overflow-visible px-1 pb-1">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 xl:text-[40px]">知识库</h1>
            <p className="mt-2 text-sm text-slate-500">顶部展示中心自定义置顶目录，下方提供真实目录云盘浏览。</p>
          </div>

          <div className="flex flex-col gap-4 xl:items-end">
            <div ref={headerSearchRef} className="relative w-full xl:w-[620px]">
              <div
                className="relative flex items-center rounded-full border px-4 py-2.5 shadow-[0_12px_24px_rgba(166,197,228,0.1)]"
                style={{
                  borderColor: appearanceConfig.searchBox.border,
                  backgroundColor: appearanceConfig.searchBox.bg,
                }}
              >
                <Search className="mr-3 h-[18px] w-[18px] shrink-0 text-slate-400" />
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
                  placeholder="请输入问题、关键词或文件主题"
                  className="h-10 flex-1 bg-transparent text-[15px] text-slate-700 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => navigate('/search')}
                  className="mr-2 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-[0_10px_18px_rgba(110,221,210,0.26)] transition-transform hover:scale-[1.01]"
                  style={aiButtonStyle}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI 检索
                </button>
                <button
                  onClick={runTitleSearch}
                  disabled={searchLoading || !keyword.trim()}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors hover:text-slate-700 disabled:opacity-60"
                  style={keywordButtonStyle}
                >
                  <Search className="h-3.5 w-3.5" />
                  关键词检索
                </button>
              </div>

              {searchOpen ? (
                <div className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-[24px] border border-white/80 bg-white/95 shadow-[0_24px_42px_rgba(174,190,216,0.2)] backdrop-blur-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <div className="text-xs font-medium text-slate-500">
                      {searchLoading ? '检索中...' : canSearch ? '标题匹配结果' : '请输入至少两个连续字'}
                    </div>
                    <button
                      onClick={() => setSearchOpen(false)}
                      className="text-xs text-slate-400 transition-colors hover:text-slate-600"
                    >
                      关闭
                    </button>
                  </div>

                  {searchError ? <div className="px-5 py-3 text-sm text-red-500">{searchError}</div> : null}

                  {!searchLoading && !searchError && canSearch && folderResults.length === 0 && fileResults.length === 0 ? (
                    <div className="px-5 py-4 text-sm text-slate-500">没有匹配到任何文件或文件夹标题。</div>
                  ) : null}

                  <div className="max-h-80 overflow-y-auto pb-2">
                    {folderResults.length ? (
                      <div className="border-t border-slate-50 px-5 py-4">
                        <div className="mb-2 text-xs text-slate-400">文件夹</div>
                        <div className="space-y-1">
                          {folderResults.map((item) => (
                            <button
                              key={`folder-${item.id}`}
                              onClick={() => {
                                setSearchOpen(false);
                                setActiveFolderId(item.id);
                              }}
                              className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-colors hover:bg-slate-50"
                            >
                              <span className="truncate text-sm text-slate-700">{item.title}</span>
                              <span className="ml-3 shrink-0 text-xs text-slate-400">{item.hit_count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {fileResults.length ? (
                      <div className="border-t border-slate-50 px-5 py-4">
                        <div className="mb-2 text-xs text-slate-400">文件</div>
                        <div className="space-y-1">
                          {fileResults.map((item) => (
                            <button
                              key={`file-${item.id}`}
                              onClick={() => {
                                setSearchOpen(false);
                                navigate(`/files/${item.id}`);
                              }}
                              className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-colors hover:bg-slate-50"
                            >
                              <span className="truncate text-sm text-slate-700">{item.title}</span>
                              <span className="ml-3 shrink-0 text-xs text-slate-400">{item.hit_count}</span>
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
        </div>

        <HomePinnedFoldersSection
          pinnedFolders={context.pinned_folders}
          pinCandidates={context.pin_candidate_folders}
          centerFolder={context.center_folder}
          appearanceConfig={appearanceConfig}
          canManagePins={!!context.center_folder.can_manage_settings}
          onOpenFolder={setActiveFolderId}
          onSavePins={handleSavePinnedFolders}
        />
      </section>

      <HomeCloudDriveSection
        enterpriseRoot={context.enterprise_root}
        centerFolder={context.center_folder}
        activeFolderId={activeFolderId}
        canCreateFolder={canCreateFolder}
        onActiveFolderChange={setActiveFolderId}
        onFolderStructureChange={loadHomeContext}
      />
    </div>
  );
};

export default Home;
