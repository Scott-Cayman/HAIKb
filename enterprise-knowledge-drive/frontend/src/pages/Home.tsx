import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
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
  RefreshCw,
  ChevronDown
} from 'lucide-react';
import api from '../services/api';
import FavoriteButton from '../components/FavoriteButton';
import LibraryItemsView from '../components/library/LibraryItemsView';
import type { CollectionItem } from '../components/library/types';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { formatDate, formatSize } from '../utils';
import { useAuthStore } from '../stores/authStore';
import FolderCoverArt from '../components/home/FolderCoverArt';
import { getFolderCoverConfig } from '../config/folderCovers';
import FolderIconBadge from '../components/folders/FolderIconBadge';
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
  display_mode?: 'icon' | 'cover' | null;
  icon_key?: string | null;
  icon_bg_from?: string | null;
  icon_bg_to?: string | null;
  icon_color?: string | null;
  card_bg_from?: string | null;
  card_bg_via?: string | null;
  card_bg_to?: string | null;
  card_glow_color?: string | null;
  can_manage_settings?: boolean;
}

interface FileType {
  id: number;
  original_name: string;
  file_ext?: string | null;
  size: number;
  created_at: string;
  folder_id: number | null;
  preview_status?: string | null;
  region_tags?: string | null;
  industry_tags?: string | null;
  keyword_tags?: string | null;
}

type FileSortKey = 'original_name' | 'size' | 'created_at';

type FolderMetaMap = Record<number, Pick<FolderType, 'id' | 'name' | 'parent_id'>>;

type TitleSearchItem = {
  id: number;
  title: string;
  kind: 'file' | 'folder';
  hit_count: number;
};

const isValidFolderId = (folderId: number | null): folderId is number =>
  typeof folderId === 'number' && Number.isInteger(folderId) && folderId > 0;

const parseTagTokens = (value?: string | null) => {
  if (!value) return [] as string[];
  const trimmed = value.trim();
  if (!trimmed) return [] as string[];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Ignore parsing errors
  }
  return trimmed
    .split(/[\n,，、]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getFileSortLabel = (key: FileSortKey) => {
  if (key === 'size') {
    return '按大小';
  }
  if (key === 'created_at') {
    return '按更新时间';
  }
  return '按文件名称';
};

const FILE_SORT_OPTIONS: { key: FileSortKey; label: string }[] = [
  { key: 'created_at', label: '按更新时间' },
  { key: 'size', label: '按大小' },
  { key: 'original_name', label: '按文件名称' },
];

const Home = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canCreateFolder = !!user?.is_admin || !!user?.is_super_admin;
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [recentFiles, setRecentFiles] = useState<FileType[]>([]);
  const folderViewMode = 'grid' as 'grid' | 'list';
  const [fileViewMode, setFileViewMode] = useState<'grid' | 'list'>('list');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<FolderType | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [folderSortConfig, setFolderSortConfig] = useState<{ key: 'name' | 'description'; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc'
  });
  const [filesSortConfig, setFilesSortConfig] = useState<{ key: FileSortKey; direction: 'asc' | 'desc' }>({
    key: 'created_at',
    direction: 'desc'
  });
  const [folderMetaMap, setFolderMetaMap] = useState<FolderMetaMap>({});
  const [appearanceConfig, setAppearanceConfig] = useState<HomeAppearanceConfig>(defaultHomeAppearance);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const { favoriteFileIds, favoriteFolderIds, loadFavoriteStatus, toggleFileFavorite, toggleFolderFavorite } = useFavoriteStatus();
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // 关键词检索相关状态
  const [keyword, setKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<TitleSearchItem[]>([]);
  const headerSearchRef = useRef<HTMLDivElement | null>(null);
  const fileSortMenuRef = useRef<HTMLDivElement | null>(null);
  const [fileSortMenuOpen, setFileSortMenuOpen] = useState(false);
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

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const node = fileSortMenuRef.current;
      if (!node) return;
      if (node.contains(event.target as Node)) return;
      setFileSortMenuOpen(false);
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

    setFolderMetaMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const folder of folders) {
        const existing = next[folder.id];
        if (!existing || existing.name !== folder.name || existing.parent_id !== folder.parent_id) {
          next[folder.id] = {
            id: folder.id,
            name: folder.name,
            parent_id: folder.parent_id,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [folders, recentFiles]);

  useEffect(() => {
    const missingFolderIds = [...new Set(recentFiles.map((file) => file.folder_id))]
      .filter(isValidFolderId)
      .filter((folderId) => !folderMetaMap[folderId]);

    if (missingFolderIds.length === 0) return;

    let cancelled = false;

    const fetchMissingFolderMeta = async () => {
      try {
        const nextMetaMap: FolderMetaMap = {};

        const fetchFolderChain = async (folderId: number) => {
          let currentId: number | null = folderId;

          while (isValidFolderId(currentId) && !folderMetaMap[currentId] && !nextMetaMap[currentId]) {
            const response: { data: Partial<FolderType> } = await api.get(`/folders/${currentId}`);
            const folderData: Partial<FolderType> = response.data;

            if (!folderData.id || !folderData.name) {
              break;
            }

            nextMetaMap[folderData.id] = {
              id: folderData.id,
              name: folderData.name,
              parent_id: folderData.parent_id ?? null,
            };

            currentId = folderData.parent_id ?? null;
          }
        };

        await Promise.all(missingFolderIds.map((folderId) => fetchFolderChain(folderId)));

        if (cancelled) return;

        if (Object.keys(nextMetaMap).length === 0) return;

        setFolderMetaMap((prev) => ({ ...prev, ...nextMetaMap }));
      } catch (error) {
        console.error('Failed to fetch missing folder metadata', error);
      }
    };

    fetchMissingFolderMeta();

    return () => {
      cancelled = true;
    };
  }, [recentFiles, folderMetaMap]);

  useEffect(() => {
    if (!openMenuId) return;
    const onMouseDown = () => setOpenMenuId(null);
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [openMenuId]);

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

  const handleFilesSort = (key: FileSortKey) => {
    setFilesSortConfig(prev => ({
      key,
      direction: prev.key === key ? (prev.direction === 'asc' ? 'desc' : 'asc') : (key === 'created_at' ? 'desc' : 'asc')
    }));
  };

  const handleFilesSortKeySelect = (key: FileSortKey) => {
    setFilesSortConfig((prev) => ({
      key,
      direction: prev.key === key ? prev.direction : (key === 'created_at' ? 'desc' : 'asc'),
    }));
    setFileSortMenuOpen(false);
  };

  const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const getFavoriteButtonVisibility = (active: boolean) => (active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100');
  const aiButtonStyle = {
    backgroundImage: gradientToCss(appearanceConfig.aiButton),
    color: appearanceConfig.aiButton.text,
  };
  const keywordButtonStyle = {
    backgroundColor: appearanceConfig.keywordButton.bg,
    color: appearanceConfig.keywordButton.text,
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

  const availableFileTags = Array.from(
    new Set(
      recentFiles.flatMap((file) => [
        ...parseTagTokens(file.region_tags),
        ...parseTagTokens(file.industry_tags),
        ...parseTagTokens(file.keyword_tags),
      ]),
    ),
  ).sort((a, b) => naturalCollator.compare(a, b));

  const filteredRecentFiles = activeTagFilter
    ? sortedRecentFiles.filter((file) => {
        const fileTags = [
          ...parseTagTokens(file.region_tags),
          ...parseTagTokens(file.industry_tags),
          ...parseTagTokens(file.keyword_tags),
        ];
        return fileTags.includes(activeTagFilter);
      })
    : sortedRecentFiles;

  const getFolderPath = (folderId: number) => {
    const pathSegments: string[] = [];
    const visited = new Set<number>();
    let currentId: number | null = folderId;

    while (isValidFolderId(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      const currentFolder: FolderMetaMap[number] | undefined = folderMetaMap[currentId];

      if (!currentFolder) {
        pathSegments.push(`文件夹 ${currentId}`);
        break;
      }

      pathSegments.push(currentFolder.name);
      currentId = currentFolder.parent_id;
    }

    return pathSegments.reverse().join(' / ');
  };

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

  const recentFileCollectionItems: CollectionItem[] = filteredRecentFiles.map((file) => {
    const folderPath = isValidFolderId(file.folder_id) ? getFolderPath(file.folder_id) : '未归档';

    return {
      kind: 'file',
      id: file.id,
      name: file.original_name,
      onOpen: () => navigate(`/files/${file.id}`),
      sizeLabel: formatSize(file.size),
      dateLabel: formatDate(file.created_at),
      fileExt: file.file_ext,
      previewStatus: file.preview_status,
      secondaryLabel: isValidFolderId(file.folder_id) ? null : '未归档',
      folderLink: isValidFolderId(file.folder_id)
        ? {
            label: folderPath,
            title: folderPath,
            onClick: (event) => {
              event.stopPropagation();
              navigate(`/folders/${file.folder_id}`);
            },
          }
        : null,
      favorite: {
        active: favoriteFileIds.has(file.id),
        title: favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件',
        onClick: () => handleToggleFileFavorite(file.id),
      },
      action: {
        label: '查看',
        onClick: (event) => {
          event.stopPropagation();
          navigate(`/files/${file.id}`);
        },
      },
    };
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 pb-2">
      <section className="shrink-0 overflow-visible px-1 pb-1">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 xl:text-[40px]">知识库</h1>
            <p className="mt-2 text-sm text-slate-500">集中管理企业资料、培训文档与项目知识</p>
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
        </div>

        <div className="flex flex-col gap-4">
          {folderViewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {sortedFolders.map((folder) => {
                const coverConfig = getFolderCoverConfig(folder, appearanceConfig.folderCard);
                const folderCardStyle = {
                  backgroundImage: gradientToCss({
                    from: coverConfig.cardBgFrom,
                    via: coverConfig.cardBgVia,
                    to: coverConfig.cardBgTo,
                  }),
                };
                return (
                  <div
                    key={folder.id}
                    onClick={() => navigate(`/folders/${folder.id}`)}
                    className="group relative min-h-[172px] cursor-pointer overflow-hidden rounded-[24px] border border-white/75 p-[18px] shadow-[0_14px_30px_rgba(179,194,219,0.16)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_34px_rgba(153,176,209,0.2)]"
                    style={folderCardStyle}
                  >
                    <div
                      className="absolute inset-0"
                      style={{ backgroundImage: radialGlowToCss(coverConfig.cardGlowColor) }}
                    />
                    <div className="absolute inset-y-4 right-4 w-[44%] overflow-hidden rounded-[20px]">
                      <FolderCoverArt
                        displayMode={coverConfig.displayMode}
                        imageUrl={coverConfig.imageUrl}
                        iconKey={coverConfig.iconKey}
                        iconBgFrom={coverConfig.iconBgFrom}
                        iconBgTo={coverConfig.iconBgTo}
                        iconColor={coverConfig.iconColor}
                        glowColor={coverConfig.cardGlowColor}
                      />
                    </div>

                    <div className="relative z-10 flex min-h-[142px] max-w-[56%] flex-col">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <span
                          className="inline-flex rounded-full px-3 py-1 text-[11px] font-semibold shadow-sm"
                          style={{
                            backgroundColor: coverConfig.theme.badge.bg,
                            color: coverConfig.theme.badge.text,
                          }}
                        >
                          {coverConfig.statsLabel}
                        </span>
                      </div>
                      <h3 className="max-w-[180px] text-[24px] font-black leading-tight tracking-tight text-slate-900 xl:text-[26px]">
                        {coverConfig.title}
                      </h3>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 xl:text-sm xl:leading-6">
                        {coverConfig.subtitle}
                      </p>
                    </div>

                    <div className="absolute right-4 top-4 z-20 flex items-center gap-1.5">
                      <FavoriteButton
                        active={favoriteFolderIds.has(folder.id)}
                        title={favoriteFolderIds.has(folder.id) ? '取消收藏文件夹' : '收藏文件夹'}
                        className={`h-8 w-8 rounded-full border-white/70 bg-white/70 ${getFavoriteButtonVisibility(favoriteFolderIds.has(folder.id))}`}
                        onClick={() => handleToggleFolderFavorite(folder.id)}
                      />
                      {folder.can_manage_settings && (
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
                                onClick={() => navigate(`/folders/${folder.id}/settings`)}
                                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                              >
                                <PencilLine className="h-4 w-4 text-slate-500" />
                                编辑配置
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

              {canCreateFolder && !isCreatingFolder && (
                <div
                  onClick={() => setIsCreatingFolder(true)}
                  className="group flex min-h-[172px] cursor-pointer flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-[#d6dee8] bg-white/55 shadow-[0_14px_28px_rgba(196,207,225,0.1)] transition-all hover:-translate-y-1 hover:border-[#ffd59b] hover:bg-white/80"
                >
                  <div
                    className="mb-4 flex h-14 w-14 items-center justify-center rounded-full shadow-[0_16px_24px_rgba(255,197,167,0.3)]"
                    style={aiButtonStyle}
                  >
                    <Plus className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-lg font-bold text-slate-700">新建文件夹</div>
                  <div className="mt-2 text-sm text-slate-400">创建新的知识库空间</div>
                </div>
              )}

              {canCreateFolder && isCreatingFolder && (
                <form
                  onSubmit={handleCreateFolder}
                  className="flex min-h-[172px] flex-col justify-center rounded-[24px] border border-[#cde7df] bg-white/85 p-5 shadow-[0_16px_28px_rgba(190,204,224,0.16)]"
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
            <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/82 shadow-[0_16px_34px_rgba(182,195,217,0.14)]">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-slate-700">文件夹列表</div>
                  <div className="mt-1 text-xs text-slate-400">保持原有功能，仅切换视觉视图</div>
                </div>
                {canCreateFolder && !isCreatingFolder ? (
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
              {canCreateFolder && isCreatingFolder ? (
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
                              <div className="mr-3">
                                <FolderIconBadge
                                  iconKey={folder.icon_key}
                                  iconBgFrom={folder.icon_bg_from || appearanceConfig.folderListIcon.from}
                                  iconBgTo={folder.icon_bg_to || appearanceConfig.folderListIcon.to}
                                  iconColor={folder.icon_color || appearanceConfig.folderListIcon.iconColor}
                                  className="h-10 w-10 rounded-2xl"
                                  iconClassName="h-5 w-5"
                                />
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
                              {folder.can_manage_settings && (
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
                                        onClick={() => navigate(`/folders/${folder.id}/settings`)}
                                        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                      >
                                        <PencilLine className="h-4 w-4 text-slate-500" />
                                        编辑配置
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

      <section className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/74 shadow-[0_18px_42px_rgba(183,197,221,0.14)] backdrop-blur-xl">
        <div className="shrink-0 border-b border-slate-100 bg-white/80 px-5 py-5 backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d9ece8] bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              <File className="h-4 w-4" style={{ color: appearanceConfig.fileListIcon.iconColor }} />
              全部文件
            </div>
            {availableFileTags.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTagFilter(null)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                    activeTagFilter === null
                      ? 'border border-[#d9ece8] bg-[#eefcf8] font-semibold text-slate-700'
                      : 'bg-[#f7fafc] text-slate-500 hover:text-slate-700'
                  }`}
                >
                  全部标签
                </button>
                {availableFileTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveTagFilter(tag)}
                    className={`inline-flex items-center rounded-full px-4 py-2 text-sm transition-colors ${
                      activeTagFilter === tag
                        ? 'border border-[#d9ece8] bg-[#eefcf8] font-semibold text-slate-700'
                        : 'bg-[#f7fafc] text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setFilesSortConfig({ key: 'created_at', direction: 'desc' });
                setFolderSortConfig({ key: 'name', direction: 'asc' });
                setActiveTagFilter(null);
              }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-slate-400 transition-colors hover:text-slate-600"
            >
              <RefreshCw className="h-4 w-4" />
              重置
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div ref={fileSortMenuRef} className="relative flex items-center">
              <div
                className={`pointer-events-none absolute right-full top-1/2 z-20 mr-2 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap transition-all duration-300 ${
                  fileSortMenuOpen ? 'pointer-events-auto translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
                }`}
              >
                {FILE_SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleFilesSortKeySelect(option.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm transition-all duration-300 ${
                      filesSortConfig.key === option.key
                        ? 'border-[#d9ece8] bg-[#eefcf8] font-semibold text-slate-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                    }`}
                  >
                    <span>{option.label}</span>
                    {filesSortConfig.key === option.key ? (
                      <span className="text-xs text-slate-400">{filesSortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFileSortMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
              >
                {getFileSortLabel(filesSortConfig.key)}
                <ChevronDown className={`h-4 w-4 transition-transform ${fileSortMenuOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
            <div
              className="flex items-center rounded-full p-1"
              style={{ backgroundColor: appearanceConfig.viewToggle.trackBg }}
            >
              <button
                type="button"
                onClick={() => setFileViewMode('grid')}
                onMouseDown={(e) => e.stopPropagation()}
                className={`rounded-full p-2.5 transition-all ${fileViewMode === 'grid' ? 'shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                style={fileViewMode === 'grid' ? {
                  backgroundColor: appearanceConfig.viewToggle.activeBg,
                  color: appearanceConfig.viewToggle.activeText,
                } : undefined}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFileViewMode('list')}
                onMouseDown={(e) => e.stopPropagation()}
                className={`rounded-full p-2.5 transition-all ${fileViewMode === 'list' ? 'shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                style={fileViewMode === 'list' ? {
                  backgroundColor: appearanceConfig.viewToggle.activeBg,
                  color: appearanceConfig.viewToggle.activeText,
                } : undefined}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {recentFileCollectionItems.length > 0 ? (
            <LibraryItemsView
              items={recentFileCollectionItems}
              viewMode={fileViewMode}
              onViewModeChange={setFileViewMode}
              showHeader={false}
              nameColumn={{
                label: '文件名称',
                onClick: () => handleFilesSort('original_name'),
                direction: filesSortConfig.key === 'original_name' ? filesSortConfig.direction : null,
              }}
              secondaryColumn={{ label: '上级目录' }}
              sizeColumn={{
                label: '大小',
                onClick: () => handleFilesSort('size'),
                direction: filesSortConfig.key === 'size' ? filesSortConfig.direction : null,
              }}
              dateColumn={{
                label: '更新时间',
                onClick: () => handleFilesSort('created_at'),
                direction: filesSortConfig.key === 'created_at' ? filesSortConfig.direction : null,
              }}
              emptyState={
                recentFiles.length > 0 ? (
                  <div className="flex h-full items-center justify-center p-8 text-center text-slate-500">当前标签下暂无文件</div>
                ) : undefined
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-slate-500">暂无近期更新的文件</div>
          )}
        </div>
      </section>

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
