import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowDownAZ, CalendarDays, Check, ChevronLeft, ChevronRight, FileType, FolderPlus, FolderUp, Grid2X2, HardDrive, List, Loader2, MoreVertical, PencilLine, Tags, Trash2, UploadCloud, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import LibraryItemsView from '../library/LibraryItemsView';
import type { CollectionItem } from '../library/types';
import api from '../../services/api';
import { ragApi, type BatchSummaryTaskResponse } from '../../services/ragApi';
import { useFavoriteStatus } from '../../hooks/useFavoriteStatus';
import { useKnowledgeViewMode } from '../../hooks/useKnowledgeViewMode';
import { formatFolderDisplayName, type FolderSummary, type ResourceCapabilities } from '../../services/homeFolders';
import { formatDate, formatSize } from '../../utils';
import {
  collectDroppedUpload,
  createUploadCandidates,
  deriveDirectoryPaths,
  type UploadCandidate,
} from '../../services/uploadDrop';

const DEFAULT_CREATED_AT_LABEL = '26年7月1日';

type FileSummary = {
  id: number;
  original_name: string;
  size: number;
  created_at?: string | null;
  client_type?: string | null;
  project_type?: string | null;
  document_type?: string | null;
  region_tags?: string | null;
  industry_tags?: string | null;
  keyword_tags?: string | null;
  preview_status: string;
  thumbnail_status?: string | null;
  preview_kind?: string | null;
  preview_page_count?: number;
  preview_error?: string | null;
  folder_id: number | null;
  file_ext?: string | null;
  capabilities?: ResourceCapabilities;
};

type BreadcrumbItem = {
  key: string;
  label: string;
  targetFolderId: number | null;
  current: boolean;
};

type ActionTarget = {
  kind: 'folder' | 'file';
  id: number;
  name: string;
  size?: number;
};

type Props = {
  centerFolder: FolderSummary;
  activeFolderId: number;
  canCreateFolder: boolean;
  onActiveFolderChange: (folderId: number) => void;
  onFolderStructureChange: () => Promise<void>;
};

type InlineItemMenuProps = {
  isOpen: boolean;
  canRename: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
};

type SortKey = 'name' | 'file_ext' | 'created_at' | 'size';

const SORT_OPTIONS = [
  { key: 'name' as const, label: '名称', Icon: ArrowDownAZ },
  { key: 'file_ext' as const, label: '类型', Icon: FileType },
  { key: 'created_at' as const, label: '日期', Icon: CalendarDays },
  { key: 'size' as const, label: '大小', Icon: HardDrive },
];

const CompactSortControl = ({ value, onChange }: { value: SortKey; onChange: (key: SortKey) => void }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeOption = SORT_OPTIONS.find((option) => option.key === value) || SORT_OPTIONS[0];
  const ActiveSortIcon = activeOption.Icon;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative z-20 h-10 w-[76px] shrink-0">
      <div
        aria-hidden={!open}
        className={`absolute right-[82px] top-0 flex items-center gap-1 rounded-xl bg-slate-100 p-1 shadow-sm transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-3 opacity-0'
        }`}
      >
        {SORT_OPTIONS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              onChange(key);
              setOpen(false);
            }}
            tabIndex={open ? 0 : -1}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition-colors active:translate-y-px ${
              value === key ? 'bg-white text-[#239f94] shadow-sm' : 'text-slate-500 hover:bg-white/75 hover:text-slate-700'
            }`}
            aria-pressed={value === key}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-10 w-[76px] items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-2.5 text-xs font-medium transition-colors active:translate-y-px ${
          open ? 'text-[#239f94]' : 'text-slate-600 hover:text-slate-800'
        }`}
        aria-expanded={open}
        aria-label={`排序方式：${activeOption.label}`}
        title="排序方式"
      >
        <ActiveSortIcon className="h-4 w-4" />
        <span>{activeOption.label}</span>
      </button>
    </div>
  );
};

const InlineItemMenu = ({
  isOpen,
  canRename,
  canDelete,
  onToggle,
  onRename,
  onDelete,
}: InlineItemMenuProps) => {
  const actionCount = Number(canRename) + Number(canDelete);
  if (actionCount === 0) return null;

  const expandedWidth = actionCount === 2 ? 'w-[92px]' : 'w-[60px]';
  const triggerShift = actionCount === 2 ? '-translate-x-16' : '-translate-x-8';

  return (
    <div
      className={`relative h-7 shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        isOpen ? expandedWidth : 'w-7'
      }`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={isOpen ? '收起操作' : '更多操作'}
        title={isOpen ? '收起操作' : '更多操作'}
        onClick={onToggle}
        className={`absolute right-0 top-0 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full transition-[transform,color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          isOpen ? `${triggerShift} bg-slate-100 text-slate-700` : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <MoreVertical className={`h-3.5 w-3.5 transition-transform duration-300 motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      <div
        className={`absolute right-0 top-0 flex origin-right items-center gap-1 transition-[transform,opacity] duration-200 motion-reduce:transition-none ${
          isOpen ? 'translate-x-0 scale-100 opacity-100' : 'pointer-events-none translate-x-2 scale-90 opacity-0'
        }`}
      >
        {canRename ? (
          <button
            type="button"
            aria-label="重命名"
            title="重命名"
            aria-hidden={!isOpen}
            tabIndex={isOpen ? 0 : -1}
            onClick={onRename}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
          >
            <PencilLine className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            aria-label="删除"
            title="删除"
            aria-hidden={!isOpen}
            tabIndex={isOpen ? 0 : -1}
            onClick={onDelete}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-red-500 transition-colors hover:bg-red-100 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

const HomeCloudDriveSection = ({
  centerFolder,
  activeFolderId,
  onActiveFolderChange,
  onFolderStructureChange,
}: Props) => {
  const navigate = useNavigate();
  const folderCacheRef = useRef<Map<number, FolderSummary>>(new Map());
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const summaryPollTimerRef = useRef<number | null>(null);
  const [currentFolder, setCurrentFolder] = useState<FolderSummary | null>(null);
  const [subfolders, setSubfolders] = useState<FolderSummary[]>([]);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [viewMode, setViewMode] = useKnowledgeViewMode();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [summaryTask, setSummaryTask] = useState<BatchSummaryTaskResponse | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [showCreateFolderInput, setShowCreateFolderInput] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ActionTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ActionTarget | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { favoriteFileIds, favoriteFolderIds, loadFavoriteStatus, toggleFileFavorite, toggleFolderFavorite } = useFavoriteStatus();
  const isSummaryRunning = summaryTask?.status === 'running';

  useEffect(() => () => {
    if (summaryPollTimerRef.current) {
      window.clearTimeout(summaryPollTimerRef.current);
    }
  }, []);

  useEffect(() => {
    folderCacheRef.current.set(centerFolder.id, centerFolder);
  }, [centerFolder]);

  useEffect(() => {
    if (!openMenuKey) return;
    const onMouseDown = () => setOpenMenuKey(null);
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [openMenuKey]);

  useEffect(() => {
    if (!renameTarget && !deleteTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || actionLoading) return;
      setRenameTarget(null);
      setDeleteTarget(null);
      setActionError(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionLoading, deleteTarget, renameTarget]);

  const getFolderById = async (folderId: number) => {
    const cached = folderCacheRef.current.get(folderId);
    if (cached) {
      return cached;
    }
    const response = await api.get<FolderSummary>(`/folders/${folderId}`);
    folderCacheRef.current.set(folderId, response.data);
    return response.data;
  };

  const buildBreadcrumbs = async (folder: FolderSummary) => {
    const chain: FolderSummary[] = [folder];
    const visited = new Set<number>([folder.id]);
    let parentId = folder.parent_id;

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parentFolder = await getFolderById(parentId);
      chain.unshift(parentFolder);
      parentId = parentFolder.parent_id;
    }

    const nextBreadcrumbs: BreadcrumbItem[] = [];
    chain.forEach((item, index) => {
      const isLast = index === chain.length - 1;
      nextBreadcrumbs.push({
        key: `folder-${item.id}-${index}`,
        label: formatFolderDisplayName(item.name),
        targetFolderId: isLast ? null : item.id,
        current: isLast,
      });
    });

    setBreadcrumbs(nextBreadcrumbs);
  };

  const loadFolderData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [folderRes, subfoldersRes, filesRes] = await Promise.all([
        api.get<FolderSummary>(`/folders/${activeFolderId}`),
        api.get<FolderSummary[]>('/folders', { params: { parent_id: activeFolderId } }),
        api.get<FileSummary[]>(`/files/folder/${activeFolderId}`),
      ]);
      folderCacheRef.current.set(folderRes.data.id, folderRes.data);
      setCurrentFolder(folderRes.data);
      setSubfolders(subfoldersRes.data);
      setFiles(filesRes.data);
      await buildBreadcrumbs(folderRes.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '加载当前目录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFolderData();
  }, [activeFolderId]);

  useEffect(() => {
    const folderIds = subfolders.map((folder) => folder.id);
    const fileIds = files.map((file) => file.id);
    if (folderIds.length === 0 && fileIds.length === 0) return;
    loadFavoriteStatus({ folderIds, fileIds }).catch((favoriteError) => {
      console.error('Failed to load favorite status', favoriteError);
    });
  }, [files, loadFavoriteStatus, subfolders]);

  async function pollSummaryTask(taskId: string) {
    try {
      const task = await ragApi.getBatchSummaryTask(taskId);
      setSummaryTask(task);
      if (task.status === 'running') {
        summaryPollTimerRef.current = window.setTimeout(() => {
          void pollSummaryTask(taskId);
        }, 2000);
        return;
      }

      await loadFolderData();
      await onFolderStructureChange();
      if (task.status === 'failed' || task.status === 'partial_failed') {
        setError(task.message || '部分文件的 AI 总结生成失败，请稍后重试');
      }
    } catch (summaryError: any) {
      setError(summaryError?.response?.data?.detail || '读取 AI 总结任务进度失败');
    }
  }

  const startBatchSummary = async (fileIds: number[]) => {
    if (fileIds.length === 0) return;
    const task = await ragApi.batchSummarizeFiles(fileIds);
    setSummaryTask(task);
    if (summaryPollTimerRef.current) {
      window.clearTimeout(summaryPollTimerRef.current);
    }
    if (task.status === 'running') {
      summaryPollTimerRef.current = window.setTimeout(() => {
        void pollSummaryTask(task.task_id);
      }, 1500);
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await api.post('/folders', {
        name,
        parent_id: activeFolderId,
      });
      setNewFolderName('');
      setShowCreateFolderInput(false);
      await loadFolderData();
      await onFolderStructureChange();
    } catch (err: any) {
      setError(err?.response?.data?.detail || '创建文件夹失败');
    } finally {
      setCreating(false);
    }
  };

  const handleUploadEntries = async (uploadFiles: UploadCandidate[], directories: string[] = []) => {
    if ((!uploadFiles.length && !directories.length) || !currentFolder?.capabilities?.can_upload || isSummaryRunning) return;

    setUploading(true);
    setUploadProgress(0);
    setSummaryTask(null);
    setError(null);
    const uploadedFileIds: number[] = [];
    try {
      if (directories.length > 0) {
        await api.post('/folders/ensure-upload-paths', {
          parent_id: activeFolderId,
          paths: directories,
        });
      }
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const selectedFile = uploadFiles[index];
        const formData = new FormData();
        formData.append('file', selectedFile.file);
        formData.append('folder_id', String(activeFolderId));
        formData.append('auto_start_summary', 'false');
        if (selectedFile.relativePath !== selectedFile.file.name) {
          formData.append('relative_path', selectedFile.relativePath);
        }
        const response = await api.post<{ id: number }>('/files/upload', formData, {
          timeout: 0,
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (event) => {
            const currentRatio = event.total ? event.loaded / event.total : 0;
            setUploadProgress(Math.round(((index + currentRatio) / uploadFiles.length) * 100));
          },
        });
        uploadedFileIds.push(response.data.id);
        setUploadProgress(Math.round(((index + 1) / uploadFiles.length) * 100));
      }
      await loadFolderData();
      await onFolderStructureChange();
      if (uploadedFileIds.length > 0) {
        try {
          await startBatchSummary(uploadedFileIds);
        } catch (summaryError: any) {
          setError(summaryError?.response?.data?.detail || '文件上传成功，但启动 AI 总结任务失败');
        }
      }
    } catch (uploadError: any) {
      setError(uploadError?.response?.data?.detail || '文件上传失败，请检查网络后重试');
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
      if (folderUploadInputRef.current) folderUploadInputRef.current.value = '';
    }
  };

  const handleUploadFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;
    const candidates = createUploadCandidates(selectedFiles);
    void handleUploadEntries(candidates);
  };

  const handleUploadFolder = (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;
    const candidates = createUploadCandidates(selectedFiles);
    void handleUploadEntries(candidates, deriveDirectoryPaths(candidates));
  };

  const isFileDrag = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes('Files');

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (currentFolder?.capabilities?.can_upload && !uploading && !isSummaryRunning) {
      setIsDragActive(true);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = currentFolder?.capabilities?.can_upload && !uploading && !isSummaryRunning ? 'copy' : 'none';
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    if (!currentFolder?.capabilities?.can_upload || uploading || isSummaryRunning) {
      setError('您没有向当前目录上传内容的权限');
      return;
    }
    try {
      const dropped = await collectDroppedUpload(event.dataTransfer);
      if (!dropped.files.length && !dropped.directories.length) {
        setError('没有识别到可上传的文件或文件夹');
        return;
      }
      await handleUploadEntries(dropped.files, dropped.directories);
    } catch (dropError: any) {
      setError(dropError?.message || '读取拖入的文件夹失败');
    }
  };

  const getCreatedDateLabel = (value?: string | null) => {
    if (!value) {
      return DEFAULT_CREATED_AT_LABEL;
    }
    return formatDate(value);
  };

  const parseTagTokens = (value?: string | null) => {
    const text = (value || '').trim();
    if (!text || text === '[]') return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => String(tag).trim()).filter(Boolean);
      }
    } catch {
      // 兼容历史数据中的逗号分隔标签。
    }
    return text
      .split(/[，,;；/|]/)
      .map((tag) => tag.trim())
      .filter((tag) => Boolean(tag) && tag !== '[]');
  };

  const getFileTags = (file: FileSummary) => {
    return Array.from(
      new Set(
        [
          file.client_type,
          file.project_type,
          file.document_type,
          ...parseTagTokens(file.region_tags),
          ...parseTagTokens(file.industry_tags),
          ...parseTagTokens(file.keyword_tags),
        ].filter(Boolean) as string[],
      ),
    );
  };

  const allAvailableTags = useMemo(() => {
    const values = new Set<string>();
    files.forEach((file) => {
      getFileTags(file).forEach((tag) => values.add(tag));
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [files]);

  const naturalCollator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }), []);

  const sortedSubfolders = useMemo(() => {
    return [...subfolders].sort((a, b) => {
      if (sortKey === 'created_at') {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
      return naturalCollator.compare(a.name, b.name);
    });
  }, [naturalCollator, sortKey, subfolders]);

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      if (sortKey === 'file_ext') {
        const leftExt = (a.file_ext || (a.original_name.includes('.') ? a.original_name.split('.').pop() : '') || '').replace(/^\./, '').toLowerCase();
        const rightExt = (b.file_ext || (b.original_name.includes('.') ? b.original_name.split('.').pop() : '') || '').replace(/^\./, '').toLowerCase();
        return naturalCollator.compare(leftExt, rightExt) || naturalCollator.compare(a.original_name, b.original_name);
      }
      if (sortKey === 'created_at') {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
      if (sortKey === 'size') {
        return b.size - a.size;
      }
      return naturalCollator.compare(a.original_name, b.original_name);
    });
  }, [files, naturalCollator, sortKey]);

  const filteredFiles = useMemo(() => {
    if (!selectedTag) {
      return sortedFiles;
    }
    return sortedFiles.filter((file) => getFileTags(file).includes(selectedTag));
  }, [selectedTag, sortedFiles]);

  const handleToggleFolderFavorite = async (folderId: number) => {
    try {
      await toggleFolderFavorite(folderId);
    } catch (favoriteError) {
      console.error('Failed to toggle folder favorite', favoriteError);
      alert('更新文件夹收藏失败，请稍后重试');
    }
  };

  const handleToggleFileFavorite = async (fileId: number) => {
    try {
      await toggleFileFavorite(fileId);
    } catch (favoriteError) {
      console.error('Failed to toggle file favorite', favoriteError);
      alert('更新文件收藏失败，请稍后重试');
    }
  };

  const closeActionDialog = () => {
    if (actionLoading) return;
    setRenameTarget(null);
    setDeleteTarget(null);
    setActionError(null);
  };

  const openRenameDialog = (target: ActionTarget) => {
    setOpenMenuKey(null);
    setDeleteTarget(null);
    setRenameTarget(target);
    setRenameValue(target.name);
    setActionError(null);
  };

  const openDeleteDialog = (target: ActionTarget) => {
    setOpenMenuKey(null);
    setRenameTarget(null);
    setDeleteTarget(target);
    setActionError(null);
  };

  const handleRename = async () => {
    if (!renameTarget || actionLoading) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      setActionError(`请输入新的${renameTarget.kind === 'folder' ? '文件夹' : '文件'}名称`);
      return;
    }

    let finalName = nextName;
    if (renameTarget.kind === 'file') {
      const currentExt = renameTarget.name.includes('.') ? renameTarget.name.split('.').pop() : '';
      const hasExt = nextName.includes('.') && !nextName.endsWith('.');
      finalName = currentExt && !hasExt ? `${nextName}.${currentExt}` : nextName;
    }

    if (finalName === renameTarget.name) {
      closeActionDialog();
      return;
    }

    setActionLoading(true);
    setActionError(null);
    try {
      if (renameTarget.kind === 'folder') {
        await api.patch(`/folders/${renameTarget.id}`, { name: finalName });
      } else {
        await api.patch(`/files/${renameTarget.id}`, { original_name: finalName });
      }
      setRenameTarget(null);
      await loadFolderData();
      if (renameTarget.kind === 'folder') {
        await onFolderStructureChange();
      }
    } catch (renameError: any) {
      setActionError(renameError?.response?.data?.detail || '重命名失败，请稍后重试');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (deleteTarget.kind === 'folder') {
        await api.delete(`/folders/${deleteTarget.id}`);
      } else {
        await api.delete(`/files/${deleteTarget.id}`);
      }
      setDeleteTarget(null);
      await loadFolderData();
      if (deleteTarget.kind === 'folder') {
        await onFolderStructureChange();
      }
    } catch (deleteError: any) {
      setActionError(
        deleteError?.response?.data?.detail ||
          `删除${deleteTarget.kind === 'folder' ? '文件夹' : '文件'}失败，请稍后重试`,
      );
    } finally {
      setActionLoading(false);
    }
  };

  const items = useMemo<CollectionItem[]>(() => {
    const folderItems = sortedSubfolders.map((folder) => ({
      kind: 'folder' as const,
      id: folder.id,
      name: formatFolderDisplayName(folder.name),
      onOpen: () => onActiveFolderChange(folder.id),
      dateLabel: getCreatedDateLabel(folder.created_at),
      iconKey: !folder.icon_key || folder.icon_key === 'book-open' ? 'folder' : folder.icon_key,
      iconBgFrom: folder.icon_bg_from,
      iconBgTo: folder.icon_bg_to,
      iconColor: folder.icon_color,
      favorite: {
        active: favoriteFolderIds.has(folder.id),
        title: favoriteFolderIds.has(folder.id) ? '取消收藏文件夹' : '收藏文件夹',
        onClick: () => handleToggleFolderFavorite(folder.id),
      },
      menu:
        folder.capabilities?.can_rename || folder.capabilities?.can_delete ? (
          <InlineItemMenu
            isOpen={openMenuKey === `folder-${folder.id}`}
            canRename={!!folder.capabilities?.can_rename}
            canDelete={!!folder.capabilities?.can_delete}
            onToggle={() =>
              setOpenMenuKey((prev) => (prev === `folder-${folder.id}` ? null : `folder-${folder.id}`))
            }
            onRename={() => openRenameDialog({ kind: 'folder', id: folder.id, name: folder.name })}
            onDelete={() => openDeleteDialog({ kind: 'folder', id: folder.id, name: folder.name })}
          />
        ) : null,
    }));

    const fileItems = filteredFiles.map((file) => ({
      kind: 'file' as const,
      id: file.id,
      name: file.original_name,
      onOpen: () => navigate(`/files/${file.id}`),
      sizeLabel: formatSize(file.size),
      dateLabel: getCreatedDateLabel(file.created_at),
      previewStatus: file.preview_status,
      thumbnailStatus: file.thumbnail_status,
      fileExt: file.file_ext,
      favorite: {
        active: favoriteFileIds.has(file.id),
        title: favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件',
        onClick: () => handleToggleFileFavorite(file.id),
      },
      menu:
        file.capabilities?.can_rename || file.capabilities?.can_delete ? (
          <InlineItemMenu
            isOpen={openMenuKey === `file-${file.id}`}
            canRename={!!file.capabilities?.can_rename}
            canDelete={!!file.capabilities?.can_delete}
            onToggle={() => setOpenMenuKey((prev) => (prev === `file-${file.id}` ? null : `file-${file.id}`))}
            onRename={() => openRenameDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
            onDelete={() => openDeleteDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
          />
        ) : null,
    }));

    if (selectedTag) {
      return fileItems;
    }
    return [...folderItems, ...fileItems];
  }, [
    favoriteFileIds,
    favoriteFolderIds,
    filteredFiles,
    navigate,
    onActiveFolderChange,
    openMenuKey,
    selectedTag,
    sortedSubfolders,
  ]);

  const parentBreadcrumb = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;
  const parentTargetFolderId = parentBreadcrumb?.targetFolderId ?? null;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-100 bg-white shadow-sm md:rounded-[28px]"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      {isDragActive ? (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-[24px] border-2 border-dashed border-[#45cdbc] bg-[#effcf9]/95">
          <div className="flex flex-col items-center text-center text-[#168f83]">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
              <UploadCloud className="h-7 w-7" />
            </div>
            <div className="text-base font-semibold">松开即可上传</div>
            <div className="mt-1 text-sm text-[#4b9e95]">支持文件、文件夹和多级嵌套目录</div>
          </div>
        </div>
      ) : null}
      <div className="shrink-0 border-b border-slate-100">
        <div className="flex flex-col gap-3 px-3 py-3 md:px-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-sm text-slate-500">
            {parentTargetFolderId !== null ? (
              <button
                type="button"
                onClick={() => onActiveFolderChange(parentTargetFolderId)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 active:translate-y-px"
                title="返回上一级"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : null}
            {breadcrumbs.map((item, index) => {
              return (
                <div key={item.key} className="flex items-center gap-2">
                  {index > 0 ? <ChevronRight className="h-4 w-4 text-slate-300" /> : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (item.targetFolderId !== null) {
                        onActiveFolderChange(item.targetFolderId);
                      }
                    }}
                    disabled={item.targetFolderId === null}
                    className={`rounded-full px-3 py-1 transition-colors ${
                      item.current ? 'bg-slate-100 text-slate-700' : 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="custom-scrollbar -mx-1 flex shrink-0 items-center gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-wrap md:justify-end md:overflow-visible md:px-0 md:pb-0">
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void handleUploadFiles(event.target.files)}
            />
            <input
              ref={folderUploadInputRef}
              type="file"
              multiple
              webkitdirectory=""
              className="hidden"
              onChange={(event) => handleUploadFolder(event.target.files)}
            />
            <CompactSortControl value={sortKey} onChange={setSortKey} />

            {currentFolder?.capabilities?.can_upload ? (
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading || isSummaryRunning}
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-r from-[#54dcca] to-[#5cccf0] px-4 text-sm font-medium text-white shadow-sm transition hover:brightness-95 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
                title="上传文件"
              >
                {uploading || isSummaryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                <span>
                  {uploading
                    ? `上传中 ${uploadProgress}%`
                    : isSummaryRunning
                      ? `AI 总结 ${summaryTask?.completed_count || 0}/${summaryTask?.total_count || 0}`
                      : '上传文件'}
                </span>
              </button>
            ) : null}

            {currentFolder?.capabilities?.can_upload ? (
              <button
                type="button"
                onClick={() => folderUploadInputRef.current?.click()}
                disabled={uploading || isSummaryRunning}
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl bg-[#eefaf8] px-4 text-sm font-medium text-[#239f94] transition hover:bg-[#e2f7f3] active:translate-y-px disabled:cursor-wait disabled:opacity-60"
                title="上传文件夹"
              >
                <FolderUp className="h-4 w-4" />
                <span>上传文件夹</span>
              </button>
            ) : null}

            {currentFolder?.capabilities?.can_upload ? (
              <div className="relative flex shrink-0 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateFolderInput((prev) => !prev)}
                  className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-r from-[#54dcca] to-[#5cccf0] px-4 text-sm font-medium text-white shadow-sm transition hover:brightness-95 active:translate-y-px"
                  title="新建文件夹"
                >
                  <FolderPlus className="h-4 w-4" />
                  <span>新建文件夹</span>
                </button>

                {showCreateFolderInput ? (
                  <div className="absolute right-0 top-12 z-20 w-[min(280px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !creating && newFolderName.trim()) {
                            void handleCreateFolder();
                          }
                          if (event.key === 'Escape') {
                            setShowCreateFolderInput(false);
                            setNewFolderName('');
                          }
                        }}
                        placeholder="输入文件夹名称"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateFolder()}
                        disabled={creating || !newFolderName.trim()}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                        title="确认创建"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateFolderInput(false);
                          setNewFolderName('');
                        }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
                        title="取消"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="ml-auto flex items-center rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-lg p-2 transition-colors active:translate-y-px ${viewMode === 'list' ? 'bg-white text-[#239f94] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="列表视图"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`rounded-lg p-2 transition-colors active:translate-y-px ${viewMode === 'grid' ? 'bg-white text-[#239f94] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="缩略图视图"
              >
                <Grid2X2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {allAvailableTags.length ? (
          <div className="flex items-center gap-2 overflow-x-auto border-t border-slate-100 px-4 py-2.5">
            <div className="inline-flex shrink-0 items-center gap-1.5 pr-1 text-xs font-medium text-slate-400">
              <Tags className="h-3.5 w-3.5" />
              标签
            </div>
            <button
              type="button"
              onClick={() => setSelectedTag(null)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors active:translate-y-px ${
                selectedTag === null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
              }`}
            >
              全部
            </button>
            {allAvailableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors active:translate-y-px ${
                  selectedTag === tag ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <div className="mx-4 mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        {loading ? (
          <div className="p-8 text-center text-slate-500">正在加载目录内容...</div>
        ) : (
          <LibraryItemsView
            items={items}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            showHeader={false}
            className="h-full"
            itemCountLabel={`${items.length} 个项目`}
            nameColumn={{ label: '名称' }}
            secondaryColumn={false}
            sizeColumn={{ label: '大小' }}
            dateColumn={{ label: '创建日期' }}
            emptyState={<div className="p-12 text-center text-slate-500">当前目录暂无内容</div>}
            gridClassName="grid gap-3 p-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))] md:gap-4 md:p-4 md:[grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))]"
          />
        )}
      </div>

      {renameTarget
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-[3px]"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeActionDialog();
              }}
            >
              <form
                role="dialog"
                aria-modal="true"
                aria-labelledby="resource-rename-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRename();
                }}
                className="relative w-full max-w-[440px] overflow-hidden rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.18)] sm:p-7"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#58e3cc] via-[#70ddeb] to-[#8daff8]" />
                <button
                  type="button"
                  aria-label="关闭重命名弹窗"
                  onClick={closeActionDialog}
                  disabled={actionLoading}
                  className="absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex items-start gap-4 pr-10">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e8fbf7] text-[#19aa94]">
                    <PencilLine className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 id="resource-rename-title" className="text-lg font-semibold text-slate-900">
                      重命名{renameTarget.kind === 'folder' ? '文件夹' : '文件'}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">输入一个清晰、便于团队识别的新名称。</p>
                  </div>
                </div>

                <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="resource-rename-input">
                  新名称
                </label>
                <input
                  id="resource-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                    if (actionError) setActionError(null);
                  }}
                  disabled={actionLoading}
                  className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#54cdbb] focus:bg-white focus:ring-4 focus:ring-[#54cdbb]/15 disabled:opacity-60"
                  placeholder={`请输入${renameTarget.kind === 'folder' ? '文件夹' : '文件'}名称`}
                />
                {renameTarget.kind === 'file' ? (
                  <p className="mt-2 text-xs text-slate-400">不输入后缀时，将自动保留原文件后缀。</p>
                ) : null}
                {actionError ? (
                  <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {actionError}
                  </div>
                ) : null}

                <div className="mt-7 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeActionDialog}
                    disabled={actionLoading}
                    className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading || !renameValue.trim()}
                    className="h-11 min-w-[104px] rounded-xl bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionLoading ? '保存中...' : '保存修改'}
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}

      {deleteTarget
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-[3px]"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeActionDialog();
              }}
            >
              <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="resource-delete-title"
                aria-describedby="resource-delete-description"
                className="relative w-full max-w-[440px] overflow-hidden rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.18)] sm:p-7"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9b95] via-[#ffbbb0] to-[#ffd9c8]" />
                <button
                  type="button"
                  aria-label="关闭删除确认弹窗"
                  onClick={closeActionDialog}
                  disabled={actionLoading}
                  className="absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex items-start gap-4 pr-10">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fff0ee] text-[#e96f69]">
                    <Trash2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 id="resource-delete-title" className="text-lg font-semibold text-slate-900">确认删除</h2>
                    <p id="resource-delete-description" className="mt-1 text-sm leading-6 text-slate-500">
                      删除后将无法在知识库中继续访问该{deleteTarget.kind === 'folder' ? '文件夹' : '文件'}。
                    </p>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5">
                  <div className="truncate text-sm font-medium text-slate-800" title={deleteTarget.name}>
                    {deleteTarget.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {deleteTarget.kind === 'folder'
                      ? '文件夹及其中的内容会一并移除'
                      : deleteTarget.size !== undefined
                        ? `文件大小 ${formatSize(deleteTarget.size)}`
                        : '文件'}
                  </div>
                </div>
                {actionError ? (
                  <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {actionError}
                  </div>
                ) : null}

                <div className="mt-7 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeActionDialog}
                    disabled={actionLoading}
                    className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={actionLoading}
                    className="h-11 min-w-[104px] rounded-xl bg-[#e96f69] px-5 text-sm font-medium text-white transition hover:bg-[#dc625d] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionLoading ? '删除中...' : '确认删除'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default HomeCloudDriveSection;
