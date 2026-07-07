import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Folder,
  File,
  MoreVertical,
  LayoutGrid,
  List,
  Plus,
  PencilLine,
  Trash2,
  X,
  Search,
  Sparkles,
  Bell,
  CircleHelp,
  Maximize2,
  SlidersHorizontal,
  Users,
  RefreshCw,
  ChevronDown
} from 'lucide-react';
import api from '../services/api';
import FavoriteButton from '../components/FavoriteButton';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { formatDate, formatSize } from '../utils';
import { useAuthStore } from '../stores/authStore';
import FolderCoverArt from '../components/home/FolderCoverArt';
import { getFolderCoverConfig } from '../config/folderCovers';
import {
  defaultHomeAppearance,
  gradientToCss,
  radialGlowToCss,
  type HomeAppearanceConfig,
} from '../config/homeAppearance';
import { getHomeAppearanceConfig } from '../services/homeAppearance';

interface FolderType {
  id: number;
  name: string;
  description: string;
  parent_id: number | null;
  cover_url?: string | null;
}

interface FileType {
  id: number;
  original_name: string;
  size: number;
  created_at: string;
  folder_id: number | null;
}

type FolderNameMap = Record<number, string>;

type TitleSearchItem = {
  id: number;
  title: string;
  kind: 'file' | 'folder';
  hit_count: number;
};

const isValidFolderId = (folderId: number | null): folderId is number =>
  typeof folderId === 'number' && Number.isInteger(folderId) && folderId > 0;

const Home = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = !!user?.is_admin || !!user?.is_super_admin;
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [recentFiles, setRecentFiles] = useState<FileType[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [renameFolder, setRenameFolder] = useState<FolderType | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteFolder, setDeleteFolder] = useState<FolderType | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [folderSortConfig, setFolderSortConfig] = useState<{ key: 'name' | 'description'; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc'
  });
  const [filesSortConfig, setFilesSortConfig] = useState<{ key: 'original_name' | 'size' | 'created_at'; direction: 'asc' | 'desc' }>({
    key: 'original_name',
    direction: 'asc'
  });
  const [folderNames, setFolderNames] = useState<FolderNameMap>({});
  const [appearanceConfig, setAppearanceConfig] = useState<HomeAppearanceConfig>(defaultHomeAppearance);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const { favoriteFileIds, favoriteFolderIds, loadFavoriteStatus, toggleFileFavorite, toggleFolderFavorite } = useFavoriteStatus();

  // 关键词检索相关状态
  const [keyword, setKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<TitleSearchItem[]>([]);
  const headerSearchRef = useRef<HTMLDivElement | null>(null);
  const normalizedKeyword = keyword.replace(/\s+/g, '');
  const canSearch = normalizedKeyword.length >= 2;
  const folderResults = searchResults.filter(item => item.kind === 'folder');
  const fileResults = searchResults.filter(item => item.kind === 'file');

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

  const fetchFolders = async () => {
    try {
      const response = await api.get('/folders');
      setFolders(response.data);
    } catch (error) {
      console.error('Failed to fetch folders', error);
    }
  };

  const fetchRecentFiles = async () => {
    try {
      const response = await api.get('/files/recent');
      setRecentFiles(response.data);
    } catch (error) {
      console.error('Failed to fetch recent files', error);
    }
  };

  useEffect(() => {
    if (!fetchPromiseRef.current) {
      fetchPromiseRef.current = (async () => {
        await Promise.all([fetchFolders(), fetchRecentFiles()]);
      })();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getHomeAppearanceConfig()
      .then(({ config }) => {
        if (!cancelled) {
          setAppearanceConfig(config);
        }
      })
      .catch((error) => {
        console.error('Failed to fetch home appearance config', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const folderIds = folders.map(folder => folder.id);
    const fileIds = recentFiles.map(file => file.id);
    if (folderIds.length === 0 && fileIds.length === 0) return;

    loadFavoriteStatus({ folderIds, fileIds }).catch((error) => {
      console.error('Failed to load favorite status', error);
    });
  }, [folders, recentFiles, loadFavoriteStatus]);

  useEffect(() => {
    if (!folders.length && !recentFiles.length) return;

    setFolderNames((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const folder of folders) {
        if (next[folder.id] !== folder.name) {
          next[folder.id] = folder.name;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [folders, recentFiles]);

  useEffect(() => {
    const missingFolderIds = [...new Set(recentFiles.map((file) => file.folder_id))]
      .filter(isValidFolderId)
      .filter((folderId) => !folderNames[folderId]);

    if (missingFolderIds.length === 0) return;

    let cancelled = false;

    const fetchMissingFolderNames = async () => {
      try {
        const responses = await Promise.all(
          missingFolderIds.map((folderId) => api.get(`/folders/${folderId}`))
        );

        if (cancelled) return;

        setFolderNames((prev) => {
          const next = { ...prev };
          for (const response of responses) {
            if (response.data?.id && response.data?.name) {
              next[response.data.id] = response.data.name;
            }
          }
          return next;
        });
      } catch (error) {
        console.error('Failed to fetch missing folder names', error);
      }
    };

    fetchMissingFolderNames();

    return () => {
      cancelled = true;
    };
  }, [recentFiles, folderNames]);

  useEffect(() => {
    if (!openMenuId) return;
    const onMouseDown = () => setOpenMenuId(null);
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [openMenuId]);

  const openRename = (folder: FolderType) => {
    setOpenMenuId(null);
    setRenameFolder(folder);
    setRenameValue(folder.name);
  };

  const submitRename = async () => {
    if (!renameFolder) return;
    const next = renameValue.trim();
    if (!next) return;
    setActionLoading(true);
    try {
      await api.patch(`/folders/${renameFolder.id}`, { name: next });
      setRenameFolder(null);
      await fetchFolders();
    } catch (error: any) {
      alert(error?.response?.data?.detail || '重命名失败');
    } finally {
      setActionLoading(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteFolder) return;
    setActionLoading(true);
    try {
      await api.delete(`/folders/${deleteFolder.id}`);
      setDeleteFolder(null);
      await fetchFolders();
      await fetchRecentFiles();
    } catch (error: any) {
      alert(error?.response?.data?.detail || '删除失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFolderSort = (key: 'name' | 'description') => {
    setFolderSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleFilesSort = (key: 'original_name' | 'size' | 'created_at') => {
    setFilesSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const getFavoriteButtonVisibility = (active: boolean) => (active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100');
  const aiButtonStyle = {
    backgroundImage: gradientToCss(appearanceConfig.aiButton),
    color: appearanceConfig.aiButton.text,
  };
  const utilityButtonStyle = {
    backgroundColor: appearanceConfig.utilityButton.bg,
    borderColor: appearanceConfig.utilityButton.border,
    color: appearanceConfig.utilityButton.text,
  };
  const keywordButtonStyle = {
    backgroundColor: appearanceConfig.keywordButton.bg,
    color: appearanceConfig.keywordButton.text,
  };
  const folderCardStyle = {
    backgroundImage: gradientToCss(appearanceConfig.folderCard.gradient),
  };

  const sortedFolders = [...folders].sort((a, b) => {
    let comparison: number;
    
    if (folderSortConfig.key === 'name') {
      comparison = naturalCollator.compare(a.name, b.name);
    } else {
      comparison = naturalCollator.compare(a.description || '', b.description || '');
    }
    
    return folderSortConfig.direction === 'asc' ? comparison : -comparison;
  });

  const sortedRecentFiles = [...recentFiles].sort((a, b) => {
    let comparison: number;
    
    if (filesSortConfig.key === 'original_name') {
      comparison = naturalCollator.compare(a.original_name, b.original_name);
    } else if (filesSortConfig.key === 'size') {
      comparison = a.size - b.size;
    } else {
      comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    
    return filesSortConfig.direction === 'asc' ? comparison : -comparison;
  });

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await api.post('/folders', { name: newFolderName });
      setNewFolderName('');
      setIsCreatingFolder(false);
      fetchFolders();
    } catch (error) {
      console.error('Failed to create folder', error);
    }
  };

  const handleToggleFolderFavorite = async (folderId: number) => {
    try {
      await toggleFolderFavorite(folderId);
    } catch (error) {
      console.error('Failed to toggle folder favorite', error);
      alert('更新文件夹收藏失败，请稍后重试');
    }
  };

  const handleToggleFileFavorite = async (fileId: number) => {
    try {
      await toggleFileFavorite(fileId);
    } catch (error) {
      console.error('Failed to toggle file favorite', error);
      alert('更新文件收藏失败，请稍后重试');
    }
  };

  return (
    <div className="space-y-7 pb-2">
      <section className="overflow-visible rounded-[32px] border border-white/80 bg-white/75 p-6 shadow-[0_20px_50px_rgba(180,195,219,0.18)] backdrop-blur-xl lg:p-7">
        <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div
              className="mb-3 inline-flex items-center rounded-full px-4 py-1 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
              style={{
                backgroundColor: appearanceConfig.headerBadge.bg,
                color: appearanceConfig.headerBadge.text,
              }}
            >
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              Knowledge Base
            </div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">知识库</h1>
            <p className="mt-2 text-sm text-slate-500">集中管理企业资料、培训文档与项目知识</p>
          </div>

          <div className="flex items-center gap-2 self-start">
            {[Bell, CircleHelp, Maximize2].map((Icon, index) => (
              <button
                key={index}
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_10px_18px_rgba(191,205,225,0.16)] transition-colors hover:text-slate-600"
                style={utilityButtonStyle}
              >
                <Icon className="h-4.5 w-4.5" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div ref={headerSearchRef} className="relative flex-1">
              <div
                className="relative flex items-center rounded-full border px-5 py-3 shadow-[0_16px_34px_rgba(166,197,228,0.12)]"
                style={{
                  borderColor: appearanceConfig.searchBox.border,
                  backgroundColor: appearanceConfig.searchBox.bg,
                }}
              >
                <Search className="mr-3 h-5 w-5 shrink-0 text-slate-400" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value);
                    if (!e.target.value.trim()) {
                      setSearchResults([]);
                      setSearchError(null);
                      setSearchOpen(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      runTitleSearch();
                    }
                  }}
                  placeholder="请输入问题、关键词或文件主题"
                  className="h-12 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => navigate('/search')}
                  className="mr-3 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-[0_12px_22px_rgba(110,221,210,0.32)] transition-transform hover:scale-[1.01]"
                  style={aiButtonStyle}
                >
                  <Sparkles className="h-4 w-4" />
                  AI 检索
                </button>
                <button
                  onClick={runTitleSearch}
                  disabled={searchLoading || !keyword.trim()}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-colors hover:text-slate-700 disabled:opacity-60"
                  style={keywordButtonStyle}
                >
                  <Search className="h-4 w-4" />
                  关键词检索
                </button>
              </div>

              {searchOpen ? (
                <div className="absolute left-0 right-0 z-20 mt-3 overflow-hidden rounded-[28px] border border-white/80 bg-white/95 shadow-[0_28px_48px_rgba(174,190,216,0.22)] backdrop-blur-xl">
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
                          {folderResults.map(item => (
                            <button
                              key={`folder-${item.id}`}
                              onClick={() => {
                                setSearchOpen(false);
                                navigate(`/folders/${item.id}`);
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
                          {fileResults.map(item => (
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

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {sortedFolders.map((folder, index) => {
                const coverConfig = getFolderCoverConfig(folder, appearanceConfig.folderCard);
                return (
                  <div
                    key={folder.id}
                    onClick={() => navigate(`/folders/${folder.id}`)}
                    className="group relative min-h-[188px] cursor-pointer overflow-hidden rounded-[28px] border border-white/75 p-5 shadow-[0_18px_40px_rgba(179,194,219,0.18)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_44px_rgba(153,176,209,0.25)]"
                    style={folderCardStyle}
                  >
                    <div
                      className="absolute inset-0"
                      style={{ backgroundImage: radialGlowToCss(coverConfig.theme.glowColor) }}
                    />
                    <div className="absolute inset-y-5 right-4 w-[48%] overflow-hidden rounded-[24px]">
                      <FolderCoverArt
                        variant={index}
                        imageUrl={coverConfig.imageUrl}
                        iconGradient={coverConfig.theme.iconGradient}
                        iconColor={coverConfig.theme.iconColor}
                        glowColor={coverConfig.theme.glowColor}
                      />
                    </div>

                    <div className="relative z-10 flex min-h-[148px] max-w-[55%] flex-col">
                      <div className="mb-4 flex items-start justify-between gap-2">
                        <span
                          className="inline-flex rounded-full px-3 py-1 text-xs font-semibold shadow-sm"
                          style={{
                            backgroundColor: coverConfig.theme.badge.bg,
                            color: coverConfig.theme.badge.text,
                          }}
                        >
                          {coverConfig.statsLabel}
                        </span>
                      </div>
                      <h3 className="max-w-[180px] text-[28px] font-black leading-tight tracking-tight text-slate-900">
                        {coverConfig.title}
                      </h3>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                        {coverConfig.subtitle}
                      </p>
                    </div>

                    <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
                      <FavoriteButton
                        active={favoriteFolderIds.has(folder.id)}
                        title={favoriteFolderIds.has(folder.id) ? '取消收藏文件夹' : '收藏文件夹'}
                        className={`h-9 w-9 rounded-full border-white/70 bg-white/70 ${getFavoriteButtonVisibility(favoriteFolderIds.has(folder.id))}`}
                        onClick={() => handleToggleFolderFavorite(folder.id)}
                      />
                      {canEdit && (
                        <div className="relative inline-flex">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId((prev) => (prev === folder.id ? null : folder.id));
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="rounded-full bg-white/72 p-2 text-slate-500 opacity-0 shadow-sm transition-all hover:text-slate-700 group-hover:opacity-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {openMenuId === folder.id ? (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full z-20 mt-2 w-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_30px_rgba(188,199,220,0.25)]"
                            >
                              <button
                                type="button"
                                onClick={() => openRename(folder)}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                              >
                                <PencilLine className="h-4 w-4 text-slate-500" />
                                重命名
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setDeleteFolder(folder);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {canEdit && !isCreatingFolder && (
                <div
                  onClick={() => setIsCreatingFolder(true)}
                  className="group flex min-h-[188px] cursor-pointer flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-[#d6dee8] bg-white/55 shadow-[0_18px_34px_rgba(196,207,225,0.12)] transition-all hover:-translate-y-1 hover:border-[#ffd59b] hover:bg-white/80"
                >
                  <div
                    className="mb-4 flex h-16 w-16 items-center justify-center rounded-full shadow-[0_18px_30px_rgba(255,197,167,0.34)]"
                    style={aiButtonStyle}
                  >
                    <Plus className="h-8 w-8 text-white" />
                  </div>
                  <div className="text-xl font-bold text-slate-700">新建文件夹</div>
                  <div className="mt-2 text-sm text-slate-400">创建新的知识库空间</div>
                </div>
              )}

              {canEdit && isCreatingFolder && (
                <form
                  onSubmit={handleCreateFolder}
                  className="flex min-h-[188px] flex-col justify-center rounded-[28px] border border-[#cde7df] bg-white/85 p-5 shadow-[0_20px_34px_rgba(190,204,224,0.18)]"
                >
                  <div className="mb-4 text-lg font-bold text-slate-800">新建文件夹</div>
                  <input
                    type="text"
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="请输入文件夹名称"
                    className="mb-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none ring-0 transition focus:border-[#8de7d4] focus:shadow-[0_0_0_4px_rgba(141,231,212,0.18)]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCreatingFolder(false)}
                      className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-200"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={!newFolderName.trim()}
                      className="rounded-full px-5 py-2 text-sm font-semibold shadow-[0_12px_20px_rgba(112,220,226,0.25)] transition-opacity disabled:opacity-50"
                      style={aiButtonStyle}
                    >
                      创建
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-[28px] border border-white/80 bg-white/85 shadow-[0_18px_40px_rgba(182,195,217,0.16)]">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-slate-700">文件夹列表</div>
                  <div className="mt-1 text-xs text-slate-400">保持原有功能，仅切换视觉视图</div>
                </div>
                {canEdit && !isCreatingFolder ? (
                  <button
                    type="button"
                    onClick={() => setIsCreatingFolder(true)}
                    className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-[0_12px_22px_rgba(114,220,228,0.24)]"
                    style={aiButtonStyle}
                  >
                    <Plus className="h-4 w-4" />
                    新建文件夹
                  </button>
                ) : null}
              </div>
              {canEdit && isCreatingFolder ? (
                <form onSubmit={handleCreateFolder} className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
                  <input
                    type="text"
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="文件夹名称"
                    className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#8de7d4] focus:shadow-[0_0_0_4px_rgba(141,231,212,0.18)]"
                  />
                  <button
                    type="button"
                    onClick={() => setIsCreatingFolder(false)}
                    className="rounded-full bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!newFolderName.trim()}
                    className="rounded-full px-4 py-3 text-sm font-semibold disabled:opacity-60"
                    style={aiButtonStyle}
                  >
                    创建
                  </button>
                </form>
              ) : null}
              {folders.length ? (
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-[#fbfdff] text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <th className="cursor-pointer px-5 py-4 font-medium select-none hover:text-slate-600" onClick={() => handleFolderSort('name')}>
                        名称 {folderSortConfig.key === 'name' && (folderSortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="hidden cursor-pointer px-5 py-4 font-medium select-none hover:text-slate-600 md:table-cell" onClick={() => handleFolderSort('description')}>
                        描述 {folderSortConfig.key === 'description' && (folderSortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-5 py-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-sm">
                    {sortedFolders.map((folder, idx) => {
                      const isLastItem = idx === sortedFolders.length - 1;
                      return (
                        <tr key={folder.id} onClick={() => navigate(`/folders/${folder.id}`)} className="group cursor-pointer transition-colors hover:bg-[#fbfefe]">
                          <td className="px-5 py-4">
                            <div className="flex items-center">
                              <div
                                className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl"
                                style={{ backgroundImage: gradientToCss(appearanceConfig.folderListIcon) }}
                              >
                                <Folder className="h-5 w-5" style={{ color: appearanceConfig.folderListIcon.iconColor }} />
                              </div>
                              <span className="font-semibold text-slate-700 transition-colors group-hover:text-[#35b9ac]">{folder.name}</span>
                            </div>
                          </td>
                          <td className="hidden px-5 py-4 text-slate-500 md:table-cell">{folder.description || ''}</td>
                          <td className="px-5 py-4 text-right">
                            <div className="relative inline-flex items-center gap-2">
                              <FavoriteButton
                                active={favoriteFolderIds.has(folder.id)}
                                title={favoriteFolderIds.has(folder.id) ? '取消收藏文件夹' : '收藏文件夹'}
                                className={`h-9 w-9 rounded-full ${getFavoriteButtonVisibility(favoriteFolderIds.has(folder.id))}`}
                                onClick={() => handleToggleFolderFavorite(folder.id)}
                              />
                              {canEdit && (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId((prev) => (prev === folder.id ? null : folder.id));
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="rounded-full p-2 text-slate-400 opacity-0 transition-colors hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </button>
                                  {openMenuId === folder.id ? (
                                    <div
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      className={`absolute right-0 z-20 w-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_30px_rgba(188,199,220,0.25)] ${isLastItem ? 'bottom-full mb-1' : 'top-full mt-1'}`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => openRename(folder)}
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                      >
                                        <PencilLine className="h-4 w-4 text-slate-500" />
                                        重命名
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenMenuId(null);
                                          setDeleteFolder(folder);
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        删除
                                      </button>
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-slate-500">暂无文件夹</div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-white/80 bg-white/78 shadow-[0_22px_50px_rgba(183,197,221,0.16)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d9ece8] bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              <File className="h-4 w-4" style={{ color: appearanceConfig.fileListIcon.iconColor }} />
              全部文件
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f7fafc] px-4 py-2 text-sm text-slate-400">
              <SlidersHorizontal className="h-4 w-4" />
              全部类型
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f7fafc] px-4 py-2 text-sm text-slate-400">
              <Folder className="h-4 w-4" />
              全部文件夹
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f7fafc] px-4 py-2 text-sm text-slate-400">
              <Users className="h-4 w-4" />
              全部成员
            </div>
            <button
              type="button"
              onClick={() => {
                setFilesSortConfig({ key: 'created_at', direction: 'desc' });
                setFolderSortConfig({ key: 'name', direction: 'asc' });
              }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-slate-400 transition-colors hover:text-slate-600"
            >
              <RefreshCw className="h-4 w-4" />
              重置
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleFilesSort('created_at')}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500"
            >
              按更新时间
              <ChevronDown className="h-4 w-4" />
            </button>
            <div
              className="flex items-center rounded-full p-1"
              style={{ backgroundColor: appearanceConfig.viewToggle.trackBg }}
            >
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                onMouseDown={(e) => e.stopPropagation()}
                className={`rounded-full p-2.5 transition-all ${viewMode === 'grid' ? 'shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                style={viewMode === 'grid' ? {
                  backgroundColor: appearanceConfig.viewToggle.activeBg,
                  color: appearanceConfig.viewToggle.activeText,
                } : undefined}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                onMouseDown={(e) => e.stopPropagation()}
                className={`rounded-full p-2.5 transition-all ${viewMode === 'list' ? 'shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                style={viewMode === 'list' ? {
                  backgroundColor: appearanceConfig.viewToggle.activeBg,
                  color: appearanceConfig.viewToggle.activeText,
                } : undefined}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {recentFiles.length > 0 ? (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 bg-[#fbfdff] text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <th className="cursor-pointer px-5 py-4 font-medium select-none hover:text-slate-600" onClick={() => handleFilesSort('original_name')}>
                  文件名称 {filesSortConfig.key === 'original_name' && (filesSortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-5 py-4 font-medium">所属文件夹</th>
                <th className="hidden cursor-pointer px-5 py-4 font-medium select-none hover:text-slate-600 sm:table-cell" onClick={() => handleFilesSort('size')}>
                  大小 {filesSortConfig.key === 'size' && (filesSortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="hidden cursor-pointer px-5 py-4 font-medium select-none hover:text-slate-600 md:table-cell" onClick={() => handleFilesSort('created_at')}>
                  更新时间 {filesSortConfig.key === 'created_at' && (filesSortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-5 py-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {sortedRecentFiles.map(file => (
                <tr key={file.id} onClick={() => navigate(`/files/${file.id}`)} className="group cursor-pointer transition-colors hover:bg-[#fbfefe]">
                  <td className="px-5 py-4">
                    <div className="flex items-center">
                      <div
                        className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl"
                        style={{ backgroundImage: gradientToCss(appearanceConfig.fileListIcon) }}
                      >
                        <File className="h-5 w-5" style={{ color: appearanceConfig.fileListIcon.iconColor }} />
                      </div>
                      <span className="max-w-[220px] truncate font-semibold text-slate-700 transition-colors group-hover:text-[#34b8aa] sm:max-w-xs">
                        {file.original_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-500">
                    {isValidFolderId(file.folder_id) ? (
                      <Link
                        to={`/folders/${file.folder_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors hover:opacity-90"
                        style={{
                          backgroundColor: appearanceConfig.folderLink.bg,
                          color: appearanceConfig.folderLink.text,
                        }}
                      >
                        <Folder className="h-4 w-4" />
                        {folderNames[file.folder_id] || `文件夹 ${file.folder_id}`}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-400">
                        <Folder className="h-4 w-4" />
                        未归档
                      </span>
                    )}
                  </td>
                  <td className="hidden px-5 py-4 text-slate-500 sm:table-cell">{formatSize(file.size)}</td>
                  <td className="hidden px-5 py-4 text-slate-500 md:table-cell">{formatDate(file.created_at)}</td>
                  <td className="px-5 py-4">
                    <div className="inline-flex items-center gap-3">
                      <FavoriteButton
                        active={favoriteFileIds.has(file.id)}
                        title={favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件'}
                        className={`h-9 w-9 rounded-full ${getFavoriteButtonVisibility(favoriteFileIds.has(file.id))}`}
                        onClick={() => handleToggleFileFavorite(file.id)}
                      />
                      <button
                        className="rounded-full px-4 py-2 text-sm font-semibold opacity-0 transition-opacity group-hover:opacity-100"
                        style={{
                          backgroundColor: appearanceConfig.previewButton.bg,
                          color: appearanceConfig.previewButton.text,
                        }}
                      >
                        查看
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-8 text-center text-slate-500">暂无近期更新的文件</div>
        )}
      </section>

      {/* 重命名对话框 */}
      {renameFolder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setRenameFolder(null)}>
          <div className="w-full max-w-lg rounded-[28px] border border-white/80 bg-white shadow-[0_28px_60px_rgba(129,146,175,0.28)]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div className="text-lg font-semibold text-slate-900">重命名文件夹</div>
              <button onClick={() => setRenameFolder(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-xs text-slate-400">名称</div>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#8de7d4]/40"
                placeholder="请输入新名称"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitRename();
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-5">
              <button
                onClick={() => setRenameFolder(null)}
                disabled={actionLoading}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={submitRename}
                disabled={actionLoading || !renameValue.trim()}
                className="rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
                style={aiButtonStyle}
              >
                {actionLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 删除对话框 */}
      {deleteFolder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setDeleteFolder(null)}>
          <div className="w-full max-w-lg rounded-[28px] border border-white/80 bg-white shadow-[0_28px_60px_rgba(129,146,175,0.28)]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div className="text-lg font-semibold text-slate-900">确认删除</div>
              <button onClick={() => setDeleteFolder(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-700 leading-7">
                即将删除文件夹：<span className="font-semibold text-slate-900">{deleteFolder.name}</span>
              </p>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                删除文件夹会同时删除其中的子文件夹与文件（逻辑删除），并从检索索引中移除。
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-5">
              <button
                onClick={() => setDeleteFolder(null)}
                disabled={actionLoading}
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={submitDelete}
                disabled={actionLoading}
                className="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
              >
                {actionLoading ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Home;
