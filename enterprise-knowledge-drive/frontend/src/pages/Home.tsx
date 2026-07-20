import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';

import { useAuthStore } from '../stores/authStore';
import { defaultHomeAppearance, gradientToCss, type HomeAppearanceConfig } from '../config/homeAppearance';
import { getHomeAppearanceConfig } from '../services/homeAppearance';
import {
  getFolderPinnedContext,
  getHomeFolderContext,
  updateHomePinnedFolders,
  type HomeFolderContext,
} from '../services/homeFolders';
import HomePinnedFoldersSection from '../components/home/HomePinnedFoldersSection';
import HomeCloudDriveSection from '../components/home/HomeCloudDriveSection';

const Home = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canCreateFolder = !!user?.is_admin || !!user?.is_super_admin;
  const [appearanceConfig, setAppearanceConfig] = useState<HomeAppearanceConfig>(defaultHomeAppearance);
  const [context, setContext] = useState<HomeFolderContext | null>(null);
  const [pinnedContext, setPinnedContext] = useState<HomeFolderContext | null>(null);
  const [activeRootFolderId, setActiveRootFolderId] = useState<number | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState('');

  const normalizedKeyword = keyword.replace(/\s+/g, '');
  const canSearch = normalizedKeyword.length >= 2;
  const aiButtonStyle = {
    backgroundImage: gradientToCss(appearanceConfig.aiButton),
    color: appearanceConfig.aiButton.text,
  };
  const keywordButtonStyle = {
    backgroundColor: appearanceConfig.keywordButton.bg,
    color: appearanceConfig.keywordButton.text,
  };
  const currentDomainLabel = useMemo(() => {
    if (!pinnedContext) {
      return null;
    }
    const { enterprise_root, center_folder } = pinnedContext;
    const isEnterpriseScope = enterprise_root.id === center_folder.id;
    return isEnterpriseScope ? enterprise_root.name : `${enterprise_root.name} / ${center_folder.name}`;
  }, [pinnedContext]);

  const loadHomeContext = async (rootFolderId?: number, resetActiveFolder = false) => {
    const response = await getHomeFolderContext(rootFolderId);
    const nextContext: HomeFolderContext = {
      root_folders: response.root_folders || [],
      enterprise_root: response.enterprise_root,
      center_folder: response.center_folder,
      pinned_folders: response.pinned_folders || [],
      pin_candidate_folders: response.pin_candidate_folders || [],
    };
    setContext(nextContext);
    setActiveRootFolderId(nextContext.center_folder.id);
    setActiveFolderId((prev) => (resetActiveFolder ? nextContext.center_folder.id : prev ?? nextContext.center_folder.id));
  };

  const loadPinnedContext = async (folderId: number) => {
    const response = await getFolderPinnedContext(folderId);
    const nextContext: HomeFolderContext = {
      root_folders: response.root_folders || [],
      enterprise_root: response.enterprise_root,
      center_folder: response.center_folder,
      pinned_folders: response.pinned_folders || [],
      pin_candidate_folders: response.pin_candidate_folders || [],
    };
    setPinnedContext(nextContext);
  };

  useEffect(() => {
    let cancelled = false;

    const loadPage = async () => {
      try {
        const [{ config }, homeContextResponse] = await Promise.all([
          getHomeAppearanceConfig(),
          getHomeFolderContext(),
        ]);
        if (cancelled) return;
        const homeContext: HomeFolderContext = {
          root_folders: homeContextResponse.root_folders || [],
          enterprise_root: homeContextResponse.enterprise_root,
          center_folder: homeContextResponse.center_folder,
          pinned_folders: homeContextResponse.pinned_folders || [],
          pin_candidate_folders: homeContextResponse.pin_candidate_folders || [],
        };
        setAppearanceConfig(config);
        setContext(homeContext);
        setActiveRootFolderId(homeContext.center_folder.id);
        setActiveFolderId(homeContext.center_folder.id);
        setPinnedContext(homeContext);
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
    if (activeFolderId === null) return;
    loadPinnedContext(activeFolderId).catch((error) => {
      console.error('Failed to load pinned folders context', error);
    });
  }, [activeFolderId]);

  const openSearch = (mode: 'ai' | 'keyword') => {
    const params = new URLSearchParams({ mode });
    const trimmedKeyword = keyword.trim();
    if (trimmedKeyword) {
      params.set('q', trimmedKeyword);
    }
    navigate(`/search?${params.toString()}`);
  };

  const handleSavePinnedFolders = async (folderIds: number[]) => {
    if (!pinnedContext) return;
    const response = await updateHomePinnedFolders(pinnedContext.center_folder.id, folderIds);
    const nextContext: HomeFolderContext = {
      root_folders: response.root_folders || pinnedContext.root_folders || [],
      enterprise_root: response.enterprise_root,
      center_folder: response.center_folder,
      pinned_folders: response.pinned_folders || [],
      pin_candidate_folders: response.pin_candidate_folders || [],
    };
    setPinnedContext(nextContext);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">首页加载中...</div>;
  }

  if (!context || activeFolderId === null) {
    return <div className="p-8 text-center text-slate-500">未找到当前部门对应的知识库目录</div>;
  }

  return (
    <div className="flex min-h-full flex-col gap-3 overflow-visible md:h-full md:min-h-0 md:gap-2 md:overflow-hidden">
      <section className="shrink-0 overflow-visible px-1 pt-1">
        <div className="mb-1 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 flex-1">
            {currentDomainLabel ? (
              <div className="truncate text-lg font-black tracking-tight text-slate-900">{currentDomainLabel}</div>
            ) : null}
          </div>
          <div className="flex w-full flex-col gap-2 xl:max-w-[620px] xl:items-end">
            <div className="relative w-full">
              <div
                className="relative flex flex-wrap items-center gap-2 rounded-[22px] border p-2 shadow-[0_12px_24px_rgba(166,197,228,0.1)] sm:flex-nowrap sm:rounded-full sm:px-4 sm:py-2"
                style={{
                  borderColor: appearanceConfig.searchBox.border,
                  backgroundColor: appearanceConfig.searchBox.bg,
                }}
              >
                <Search className="ml-1 h-[18px] w-[18px] shrink-0 text-slate-400 sm:ml-0" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (canSearch) openSearch('keyword');
                    }
                  }}
                  placeholder="请输入问题、关键词或文件主题"
                  className="h-9 min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 sm:text-[15px]"
                />
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <button
                    type="button"
                    onClick={() => openSearch('ai')}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold shadow-[0_10px_18px_rgba(110,221,210,0.26)] transition-transform hover:scale-[1.01] sm:flex-none"
                    style={aiButtonStyle}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    AI 检索
                  </button>
                  <button
                    onClick={() => openSearch('keyword')}
                    disabled={!canSearch}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors hover:text-slate-700 disabled:opacity-60 sm:flex-none"
                    style={keywordButtonStyle}
                  >
                    <Search className="h-3.5 w-3.5" />
                    关键词检索
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {pinnedContext ? (
        <section className="flex h-[174px] min-h-[174px] shrink-0 px-1 md:h-auto md:min-h-0 md:basis-1/5">
          <HomePinnedFoldersSection
            pinnedFolders={pinnedContext.pinned_folders}
            pinCandidates={pinnedContext.pin_candidate_folders}
            appearanceConfig={appearanceConfig}
            canManagePins={!!pinnedContext.center_folder.can_manage_settings}
            onOpenFolder={setActiveFolderId}
            onEditFolderStyle={(folderId) => navigate(`/folders/${folderId}/settings`, { state: { focusSection: 'visual' } })}
            onSavePins={handleSavePinnedFolders}
          />
        </section>
      ) : null}

      <section className="min-h-[560px] flex-1 px-1 pb-1 md:min-h-0">
        <HomeCloudDriveSection
          centerFolder={context.center_folder}
          activeFolderId={activeFolderId}
          canCreateFolder={canCreateFolder}
          onActiveFolderChange={setActiveFolderId}
          onFolderStructureChange={async () => {
            await loadHomeContext(activeRootFolderId ?? context.center_folder.id);
            if (activeFolderId !== null) {
              await loadPinnedContext(activeFolderId);
            }
          }}
        />
      </section>
    </div>
  );
};

export default Home;
