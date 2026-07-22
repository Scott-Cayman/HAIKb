import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, File, Upload, UploadCloud, MoreVertical, CheckCircle, XCircle, Loader2, Folder, FolderInput, PencilLine, Trash2, X, Settings2, Sparkles } from 'lucide-react';
import api from '../services/api';
import { ragApi, type BatchSummaryTaskResponse } from '../services/ragApi';
import { getKnowledgeFolderPath } from '../services/knowledgeNavigation';
import FavoriteButton from '../components/FavoriteButton';
import InlineItemMenu from '../components/library/InlineItemMenu';
import LibraryItemsView from '../components/library/LibraryItemsView';
import MoveResourceDialog from '../components/library/MoveResourceDialog';
import type { CollectionItem } from '../components/library/types';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { useKnowledgeViewMode } from '../hooks/useKnowledgeViewMode';
import { formatDate, formatSize } from '../utils';
import { isExternalFileDrag, type MovableResource } from '../services/resourceMove';
import {
  collectDroppedUpload,
  createUploadCandidates,
  deriveDirectoryPaths,
  type UploadCandidate,
} from '../services/uploadDrop';
type ResourceCapabilities = {
  can_view: boolean;
  can_download: boolean;
  can_edit: boolean;
  can_rename: boolean;
  can_move: boolean;
  can_delete: boolean;
  can_upload: boolean;
  can_manage_settings: boolean;
  can_manage_permissions: boolean;
  can_pin_children: boolean;
};

interface FolderType {
  id: number;
  name: string;
  description: string;
  parent_id: number | null;
  icon_key?: string | null;
  icon_bg_from?: string | null;
  icon_bg_to?: string | null;
  icon_color?: string | null;
  can_manage_settings?: boolean;
  capabilities?: ResourceCapabilities;
}

interface FileType {
  id: number;
  original_name: string;
  size: number;
  created_at: string;
  preview_status: string;
  thumbnail_status?: string | null;
  preview_kind?: string | null;
  preview_page_count?: number;
  preview_error?: string | null;
  folder_id: number | null;
  file_ext?: string | null;
  capabilities?: ResourceCapabilities;
}

interface SubFolder {
  id: number;
  name: string;
  parent_id: number | null;
  icon_key?: string | null;
  icon_bg_from?: string | null;
  icon_bg_to?: string | null;
  icon_color?: string | null;
  can_manage_settings?: boolean;
  capabilities?: ResourceCapabilities;
}

interface UploadItem {
  id: string;
  file: File;
  relativePath: string;
  status: 'pending' | 'uploading' | 'success' | 'failed';
  progress: number;
  uploadedFileId?: number;
  error?: string;
}

type ActionTarget =
  | { kind: 'folder'; id: number; name: string }
  | { kind: 'file'; id: number; name: string; size: number };

const FolderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [folder, setFolder] = useState<FolderType | null>(null);
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<FolderType[]>([]);
  const [subfolders, setSubfolders] = useState<SubFolder[]>([]);
  const [files, setFiles] = useState<FileType[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [pendingDirectoryPaths, setPendingDirectoryPaths] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [viewMode, setViewMode] = useKnowledgeViewMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ActionTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ActionTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<MovableResource | null>(null);
  const [moveInitialFolderId, setMoveInitialFolderId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [summaryTask, setSummaryTask] = useState<BatchSummaryTaskResponse | null>(null);
  const summaryPollTimerRef = useRef<number | null>(null);
  const [showFolderActions, setShowFolderActions] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'original_name' | 'file_ext' | 'size' | 'created_at'; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc'
  });
  const [fetching, setFetching] = useState(false);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const lastFetchedIdRef = useRef<string | null>(null);
  const { favoriteFileIds, favoriteFolderIds, loadFavoriteStatus, toggleFileFavorite, toggleFolderFavorite } = useFavoriteStatus();
  const canUploadToCurrentFolder = !!folder?.capabilities?.can_upload;
  const canManageCurrentFolder = !!folder?.capabilities?.can_manage_settings;
  const canRenameCurrentFolder = !!folder?.capabilities?.can_rename;
  const canDeleteCurrentFolder = !!folder?.capabilities?.can_delete;

  const handleBackToParentFolder = useCallback(() => {
    navigate(getKnowledgeFolderPath(folder?.parent_id), { replace: true });
  }, [folder?.parent_id, navigate]);

  const buildFolderBreadcrumbs = async (currentFolder: FolderType): Promise<FolderType[]> => {
    const chain: FolderType[] = [currentFolder];
    const visited = new Set<number>([currentFolder.id]);
    let parentId = currentFolder.parent_id;

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      try {
        const response = await api.get<FolderType>(`/folders/${parentId}`);
        chain.unshift(response.data);
        parentId = response.data.parent_id;
      } catch (error) {
        console.error(`Failed to load parent folder ${parentId}`, error);
        break;
      }
    }

    return chain;
  };

  const fetchFolderData = async () => {
    if (!id || fetching) return;
    setFetching(true);
    try {
      const [folderRes, subfoldersRes, filesRes] = await Promise.all([
        api.get(`/folders/${id}`),
        api.get(`/folders?parent_id=${id}`),
        api.get(`/files/folder/${id}`)
      ]);
      const currentFolder = folderRes.data as FolderType;
      setFolder(currentFolder);
      setSubfolders(subfoldersRes.data);
      setFiles(filesRes.data);
      setFolderBreadcrumbs(await buildFolderBreadcrumbs(currentFolder));
    } catch (error) {
      console.error('Failed to fetch folder data', error);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (id !== lastFetchedIdRef.current) {
      lastFetchedIdRef.current = id ?? null;
      fetchPromiseRef.current = fetchFolderData();
    }
  }, [id]);

  useEffect(() => {
    if (!openMenuKey) return;
    const onMouseDown = () => setOpenMenuKey(null);
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [openMenuKey]);

  useEffect(() => {
    if (!showFolderActions) return;
    const onMouseDown = () => setShowFolderActions(false);
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [showFolderActions]);

  useEffect(() => {
    return () => {
      if (summaryPollTimerRef.current) {
        window.clearTimeout(summaryPollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const folderIds = [
      ...(folder ? [folder.id] : []),
      ...subfolders.map(subfolder => subfolder.id),
    ];
    const fileIds = files.map(file => file.id);
    if (folderIds.length === 0 && fileIds.length === 0) return;

    loadFavoriteStatus({ folderIds, fileIds }).catch((error) => {
      console.error('Failed to load favorite status', error);
    });
  }, [folder, subfolders, files, loadFavoriteStatus]);

  const openRenameDialog = (target: ActionTarget) => {
    setOpenMenuKey(null);
    setRenameTarget(target);
    setRenameValue(target.name);
  };

  const openMoveDialog = (target: MovableResource, initialTargetFolderId?: number) => {
    setOpenMenuKey(null);
    setMoveTarget(target);
    setMoveInitialFolderId(initialTargetFolderId ?? null);
  };

  const handleMoved = async () => {
    await fetchFolderData();
  };

  const openDeleteDialog = (target: ActionTarget) => {
    setOpenMenuKey(null);
    setDeleteTarget(target);
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (!next) return;

    setActionLoading(true);
    try {
      if (renameTarget.kind === 'folder') {
        await api.patch(`/folders/${renameTarget.id}`, { name: next });
      } else {
        const current = renameTarget.name;
        const currentExt = current.includes('.') ? current.split('.').pop() : '';
        const hasExt = next.includes('.') && !next.endsWith('.');
        const finalName = currentExt && !hasExt ? `${next}.${currentExt}` : next;
        await api.patch(`/files/${renameTarget.id}`, { original_name: finalName });
      }
      setRenameTarget(null);
      await fetchFolderData();
    } catch (error: any) {
      alert(error?.response?.data?.detail || '重命名失败');
    } finally {
      setActionLoading(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      if (deleteTarget.kind === 'folder') {
        await api.delete(`/folders/${deleteTarget.id}`);
      } else {
        await api.delete(`/files/${deleteTarget.id}`);
      }
      setDeleteTarget(null);
      await fetchFolderData();
    } catch (error: any) {
      alert(error?.response?.data?.detail || '删除失败');
    } finally {
      setActionLoading(false);
    }
  };

  const processUploadCandidates = useCallback((candidates: UploadCandidate[], directories: string[] = []) => {
    const newItems: UploadItem[] = candidates.map(({ file, relativePath }) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      relativePath,
      status: 'pending' as const,
      progress: 0,
    }));

    setUploadQueue(prev => {
      const existingKeys = new Set(prev.map((item) => `${item.relativePath}:${item.file.size}:${item.file.lastModified}`));
      return [
        ...prev,
        ...newItems.filter((item) => {
          const key = `${item.relativePath}:${item.file.size}:${item.file.lastModified}`;
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        }),
      ];
    });
    setPendingDirectoryPaths((prev) => Array.from(new Set([...prev, ...directories])));
    setUploadError(null);
    setShowUploadPanel(true);
    return newItems;
  }, []);

  const processFiles = useCallback((items: FileList | File[]) => {
    const candidates = createUploadCandidates(items);
    return processUploadCandidates(candidates, deriveDirectoryPaths(candidates));
  }, [processUploadCandidates]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  };

  const ensureDirectoryPaths = useCallback(async (paths: string[]) => {
    if (!id || paths.length === 0) return;
    await api.post('/folders/ensure-upload-paths', {
      parent_id: Number(id),
      paths,
    });
  }, [id]);

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (canUploadToCurrentFolder && !isUploading && !isSummaryRunning) {
      setIsDragActive(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canUploadToCurrentFolder && !isUploading && !isSummaryRunning ? 'copy' : 'none';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    if (!canUploadToCurrentFolder || isUploading || isSummaryRunning) {
      setUploadError('您没有向当前目录上传内容的权限');
      return;
    }

    try {
      const dropped = await collectDroppedUpload(event.dataTransfer);
      if (!dropped.files.length && !dropped.directories.length) {
        setUploadError('没有识别到可上传的文件或文件夹');
        return;
      }
      if (dropped.files.length === 0) {
        setIsUploading(true);
        await ensureDirectoryPaths(dropped.directories);
        setPendingDirectoryPaths([]);
        setUploadError(null);
        await fetchFolderData();
        return;
      }
      processUploadCandidates(dropped.files, dropped.directories);
    } catch (error: any) {
      setUploadError(error?.response?.data?.detail || error?.message || '读取拖入的文件夹失败');
    } finally {
      setIsUploading(false);
    }
  };

  const pollSummaryTask = useCallback(async (taskId: string) => {
    try {
      const task = await ragApi.getBatchSummaryTask(taskId);
      setSummaryTask(task);

      if (task.status === 'running') {
        summaryPollTimerRef.current = window.setTimeout(() => {
          pollSummaryTask(taskId);
        }, 2000);
        return;
      }

      await fetchFolderData();

      if (task.status === 'success') {
        window.setTimeout(() => {
          setUploadQueue([]);
          setSummaryTask(null);
          setShowUploadPanel(false);
        }, 2000);
        return;
      }

      if (task.status === 'failed') {
        alert(task.message || '生成失败，请联系管理员');
      }
    } catch (error: any) {
      console.error('轮询批量总结任务失败', error);
      setSummaryTask({
        task_id: taskId,
        status: 'failed',
        message: error?.response?.data?.detail || '生成失败，请联系管理员',
        total_count: 0,
        completed_count: 0,
        success_count: 0,
        failed_count: 0,
        processing_count: 0,
        pending_count: 0,
        processing_file_id: null,
        elapsed_seconds: 0,
        timeout_seconds: 300,
        retry_attempts: {},
        failed_file_ids: [],
        success_file_ids: [],
        last_error_by_file: {},
      });
    }
  }, []);

  const startBatchSummary = useCallback(async (fileIds: number[]) => {
    if (fileIds.length === 0) return;
    const task = await ragApi.batchSummarizeFiles(fileIds);
    setSummaryTask(task);
    if (summaryPollTimerRef.current) {
      window.clearTimeout(summaryPollTimerRef.current);
    }
    if (task.status === 'running') {
      summaryPollTimerRef.current = window.setTimeout(() => {
        pollSummaryTask(task.task_id);
      }, 1500);
    }
  }, [pollSummaryTask]);

  const uploadFile = async (item: UploadItem): Promise<number | null> => {
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('folder_id', id || '');
    formData.append('auto_start_summary', 'false');
    
    if (item.relativePath !== item.file.name) {
      formData.append('relative_path', item.relativePath);
    }

    try {
      setUploadQueue(prev => prev.map(u => 
        u.id === item.id ? { ...u, status: 'uploading', progress: 0 } : u
      ));
      
      const response = await api.post('/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 0,
        onUploadProgress: (event) => {
          const progress = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
          setUploadQueue(prev => prev.map(u =>
            u.id === item.id ? { ...u, status: 'uploading', progress } : u
          ));
        },
      });

      setUploadQueue(prev => prev.map(u => 
        u.id === item.id ? { ...u, status: 'success', progress: 100, uploadedFileId: response.data.id } : u
      ));
      return response.data.id;
    } catch (error: any) {
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      const fallbackMessage = status === 413
        ? '上传失败：文件超过服务器限制，请联系管理员调整上传大小限制'
        : '上传失败';
      setUploadQueue(prev => prev.map(u => 
        u.id === item.id ? { 
          ...u, 
          status: 'failed', 
          error: detail || fallbackMessage
        } : u
      ));
      return null;
    }
  };

  const retrySingleUpload = async (item: UploadItem) => {
    const uploadedFileId = await uploadFile(item);
    if (!uploadedFileId) return;
    try {
      await startBatchSummary([uploadedFileId]);
    } catch (error: any) {
      setSummaryTask({
        task_id: 'local-error',
        status: 'failed',
        message: error?.response?.data?.detail || '生成失败，请联系管理员',
        total_count: 1,
        completed_count: 0,
        success_count: 0,
        failed_count: 1,
        processing_count: 0,
        pending_count: 0,
        processing_file_id: null,
        elapsed_seconds: 0,
        timeout_seconds: 300,
        retry_attempts: {},
        failed_file_ids: [uploadedFileId],
        success_file_ids: [],
        last_error_by_file: {},
      });
    }
  };

  const startUpload = async () => {
    const pendingItems = uploadQueue.filter(u => u.status === 'pending');
    if (pendingItems.length === 0 && pendingDirectoryPaths.length === 0) return;

    setIsUploading(true);
    setSummaryTask(null);
    setUploadError(null);
    const uploadedFileIds: number[] = [];

    try {
      await ensureDirectoryPaths(pendingDirectoryPaths);
      setPendingDirectoryPaths([]);
    } catch (error: any) {
      setUploadError(error?.response?.data?.detail || '创建上传目录失败');
      setIsUploading(false);
      return;
    }

    if (pendingItems.length === 0) {
      setIsUploading(false);
      await fetchFolderData();
      return;
    }

    for (const item of pendingItems) {
      const uploadedFileId = await uploadFile(item);
      if (uploadedFileId) {
        uploadedFileIds.push(uploadedFileId);
      }
    }

    setIsUploading(false);

    if (uploadedFileIds.length > 0) {
      try {
        await startBatchSummary(uploadedFileIds);
      } catch (error: any) {
        setSummaryTask({
          task_id: 'local-error',
          status: 'failed',
          message: error?.response?.data?.detail || '生成失败，请联系管理员',
          total_count: uploadedFileIds.length,
          completed_count: 0,
          success_count: 0,
          failed_count: uploadedFileIds.length,
          processing_count: 0,
          pending_count: 0,
          processing_file_id: null,
          elapsed_seconds: 0,
          timeout_seconds: 300,
          retry_attempts: {},
          failed_file_ids: [],
          success_file_ids: [],
          last_error_by_file: {},
        });
      }
      return;
    }

    const latestFailedCount = uploadQueue.filter(u => u.status === 'failed').length;
    if (latestFailedCount === 0) {
      window.setTimeout(() => {
        setUploadQueue([]);
        setShowUploadPanel(false);
        fetchFolderData();
      }, 1500);
    }
  };

  const removeFromQueue = (itemId: string) => {
    setUploadQueue(prev => prev.filter(u => u.id !== itemId));
  };

  const retryFailed = () => {
    setUploadQueue(prev => prev.map(u => 
      u.status === 'failed' ? { ...u, status: 'pending', error: undefined, progress: 0 } : u
    ));
    setSummaryTask(null);
  };

  const handleSort = (key: 'name' | 'original_name' | 'file_ext' | 'size' | 'created_at') => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  const sortedSubfolders = [...subfolders].sort((a, b) => {
    const comparison = naturalCollator.compare(a.name, b.name);
    return sortConfig.direction === 'asc' ? comparison : -comparison;
  });

  const sortedFiles = [...files].sort((a, b) => {
    let comparison: number;
    
    if (sortConfig.key === 'file_ext') {
      const leftExt = (a.file_ext || (a.original_name.includes('.') ? a.original_name.split('.').pop() : '') || '').replace(/^\./, '').toLowerCase();
      const rightExt = (b.file_ext || (b.original_name.includes('.') ? b.original_name.split('.').pop() : '') || '').replace(/^\./, '').toLowerCase();
      comparison = naturalCollator.compare(leftExt, rightExt) || naturalCollator.compare(a.original_name, b.original_name);
    } else if (sortConfig.key === 'original_name') {
      comparison = naturalCollator.compare(a.original_name, b.original_name);
    } else if (sortConfig.key === 'size') {
      comparison = a.size - b.size;
    } else if (sortConfig.key === 'created_at') {
      comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    } else {
      comparison = naturalCollator.compare(a.original_name, b.original_name);
    }
    
    return sortConfig.direction === 'asc' ? comparison : -comparison;
  });

  const pendingCount = uploadQueue.filter(u => u.status === 'pending').length;
  const uploadingCount = uploadQueue.filter(u => u.status === 'uploading').length;
  const successCount = uploadQueue.filter(u => u.status === 'success').length;
  const failedCount = uploadQueue.filter(u => u.status === 'failed').length;
  const isSummaryRunning = summaryTask?.status === 'running';
  const canClosePanel = !isUploading && !isSummaryRunning;

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

  const folderCollectionItems: CollectionItem[] = sortedSubfolders.map((subfolder, idx) => {
    const isLastItem = idx === sortedSubfolders.length - 1 && sortedFiles.length === 0;

    return {
      kind: 'folder',
      id: subfolder.id,
      name: subfolder.name,
      onOpen: () => navigate(`/folders/${subfolder.id}`),
      secondaryLabel: '文件夹',
      statusLabel: '文件夹',
      iconKey: subfolder.icon_key,
      iconBgFrom: subfolder.icon_bg_from,
      iconBgTo: subfolder.icon_bg_to,
      iconColor: subfolder.icon_color,
      favorite: {
        active: favoriteFolderIds.has(subfolder.id),
        title: favoriteFolderIds.has(subfolder.id) ? '取消收藏文件夹' : '收藏文件夹',
        onClick: () => handleToggleFolderFavorite(subfolder.id),
      },
      move: {
        resource: { kind: 'folder' as const, id: subfolder.id, name: subfolder.name },
        enabled: !!subfolder.capabilities?.can_move,
        canAcceptDrop: !!subfolder.capabilities?.can_upload,
        onDrop: (resource: MovableResource, targetFolderId: number) => openMoveDialog(resource, targetFolderId),
      },
      menu: subfolder.can_manage_settings || subfolder.capabilities?.can_move || subfolder.capabilities?.can_delete ? (
        <div className="relative">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpenMenuKey((prev) => (prev === `folder-${subfolder.id}` ? null : `folder-${subfolder.id}`));
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="rounded-full p-2 text-slate-400 opacity-0 transition-colors hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {openMenuKey === `folder-${subfolder.id}` ? (
            <div
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              className={`absolute right-0 z-20 w-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_30px_rgba(188,199,220,0.25)] ${isLastItem ? 'bottom-full mb-1' : 'top-full mt-1'}`}
            >
              {subfolder.can_manage_settings ? (
                <button
                  type="button"
                  onClick={() => navigate(`/folders/${subfolder.id}/settings`)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <PencilLine className="h-4 w-4 text-slate-500" />
                  编辑配置
                </button>
              ) : null}
              {subfolder.capabilities?.can_move ? (
                <button
                  type="button"
                  onClick={() => openMoveDialog({ kind: 'folder', id: subfolder.id, name: subfolder.name })}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50"
                >
                  <FolderInput className="h-4 w-4" />
                  移动到
                </button>
              ) : null}
              {subfolder.capabilities?.can_delete ? (
                <button
                  type="button"
                  onClick={() => openDeleteDialog({ kind: 'folder', id: subfolder.id, name: subfolder.name })}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null,
    };
  });

  const fileCollectionItems: CollectionItem[] = sortedFiles.map((file) => {
    return {
      kind: 'file',
      id: file.id,
      name: file.original_name,
      onOpen: () => navigate(`/files/${file.id}`),
      secondaryLabel: (file.file_ext || (file.original_name.includes('.') ? file.original_name.split('.').pop() : '') || '文件').replace(/^\./, '').toUpperCase(),
      sizeLabel: formatSize(file.size),
      dateLabel: formatDate(file.created_at),
      previewStatus: file.preview_status,
      thumbnailStatus: file.thumbnail_status,
      fileExt: file.file_ext,
      favorite: {
        active: favoriteFileIds.has(file.id),
        title: favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件',
        onClick: () => handleToggleFileFavorite(file.id),
      },
      move: {
        resource: { kind: 'file' as const, id: file.id, name: file.original_name },
        enabled: !!file.capabilities?.can_move,
      },
      menu: file.capabilities?.can_rename || file.capabilities?.can_move || file.capabilities?.can_delete ? (
        <InlineItemMenu
          isOpen={openMenuKey === `file-${file.id}`}
          canRename={!!file.capabilities?.can_rename}
          canMove={!!file.capabilities?.can_move}
          canDelete={!!file.capabilities?.can_delete}
          onToggle={() => setOpenMenuKey((prev) => (prev === `file-${file.id}` ? null : `file-${file.id}`))}
          onRename={() => openRenameDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
          onMove={() => openMoveDialog({ kind: 'file', id: file.id, name: file.original_name })}
          onDelete={() => openDeleteDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
        />
      ) : null,
    };
  });

  const collectionItems: CollectionItem[] = [...folderCollectionItems, ...fileCollectionItems];

  if (!folder) return <div className="p-8 text-center text-slate-500">加载中...</div>;

  return (
    <div
      className="relative flex min-h-full flex-col gap-3 md:h-full md:min-h-0 md:gap-6"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
    >
      {isDragActive ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-[#45cdbc] bg-[#effcf9]/95">
          <div className="flex flex-col items-center text-center text-[#168f83]">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
              <UploadCloud className="h-7 w-7" />
            </div>
            <div className="text-base font-semibold">松开后加入上传队列</div>
            <div className="mt-1 text-sm text-[#4b9e95]">支持文件、文件夹和多级嵌套目录</div>
          </div>
        </div>
      ) : null}
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2 md:space-x-2">
          <button 
            onClick={handleBackToParentFolder}
            aria-label="返回上一级目录"
            title="返回上一级目录"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <nav
            aria-label="文件夹层级"
            className="custom-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-1 text-sm text-slate-500 md:gap-2"
          >
            {(folderBreadcrumbs.length > 0 ? folderBreadcrumbs : [folder]).map((item, index, trail) => {
              const isCurrent = index === trail.length - 1;
              return (
                <React.Fragment key={item.id}>
                  {index > 0 ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" /> : null}
                  {isCurrent ? (
                    <span
                      aria-current="page"
                      className="max-w-[220px] shrink-0 truncate rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-800 md:max-w-[320px]"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(getKnowledgeFolderPath(item.id), { replace: true })}
                      className="max-w-[200px] shrink-0 truncate rounded-full px-3 py-1.5 transition-colors hover:bg-slate-100 hover:text-slate-700 md:max-w-[280px]"
                      title={`进入 ${item.name}`}
                    >
                      {item.name}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
          <FavoriteButton
            active={favoriteFolderIds.has(folder.id)}
            title={favoriteFolderIds.has(folder.id) ? '取消收藏当前文件夹' : '收藏当前文件夹'}
            className="w-10 h-10"
            onClick={() => handleToggleFolderFavorite(folder.id)}
          />
        </div>
        
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-nowrap md:space-x-1">
          <button
            type="button"
            onClick={() => navigate(`/search?folderId=${folder.id}`)}
            className="inline-flex h-10 items-center rounded-xl border border-[#bfeae5] bg-[#edfbf9] px-3 text-sm font-semibold text-[#168f91] transition hover:bg-[#dcf7f4] md:px-4"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            当前目录 AI
          </button>
          {canUploadToCurrentFolder && (
            <>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                multiple
                className="hidden" 
              />
              <input 
                type="file" 
                ref={folderInputRef} 
                onChange={handleFolderSelect} 
                webkitdirectory="" 
                multiple
                className="hidden" 
              />
              {canManageCurrentFolder ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowFolderActions((prev) => !prev);
                    }}
                    className="flex items-center rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-200"
                  >
                    <MoreVertical className="mr-2 h-4 w-4" />
                    文件夹管理
                  </button>
                  {showFolderActions ? (
                    <div
                      className="absolute right-0 top-12 z-20 w-44 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowFolderActions(false);
                          navigate(`/folders/${folder.id}/settings`);
                        }}
                        className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
                      >
                        <Settings2 className="mr-2 h-4 w-4" />
                        修改设置
                      </button>
                      {canRenameCurrentFolder ? (
                        <button
                          type="button"
                          onClick={() => {
                            setShowFolderActions(false);
                            openRenameDialog({ kind: 'folder', id: folder.id, name: folder.name });
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
                        >
                          <PencilLine className="mr-2 h-4 w-4" />
                          重命名
                        </button>
                      ) : null}
                      {canDeleteCurrentFolder ? (
                        <button
                          type="button"
                          onClick={() => {
                            setShowFolderActions(false);
                            openDeleteDialog({ kind: 'folder', id: folder.id, name: folder.name });
                          }}
                          className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          删除文件夹
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button
                onClick={() => folderInputRef.current?.click()}
                disabled={isUploading || isSummaryRunning}
                className="flex items-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              >
                <Folder className="w-4 h-4 mr-2" />
                上传文件夹
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isSummaryRunning}
                className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all disabled:opacity-50"
              >
                <Upload className="w-4 h-4 mr-2" />
                {isUploading ? '上传中...' : '上传文件'}
              </button>
            </>
          )}
          {!canUploadToCurrentFolder && canManageCurrentFolder ? (
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowFolderActions((prev) => !prev);
                }}
                className="flex items-center rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-200"
              >
                <MoreVertical className="mr-2 h-4 w-4" />
                文件夹管理
              </button>
              {showFolderActions ? (
                <div
                  className="absolute right-0 top-12 z-20 w-44 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowFolderActions(false);
                      navigate(`/folders/${folder.id}/settings`);
                    }}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    修改设置
                  </button>
                  {canRenameCurrentFolder ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowFolderActions(false);
                        openRenameDialog({ kind: 'folder', id: folder.id, name: folder.name });
                      }}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      <PencilLine className="mr-2 h-4 w-4" />
                      重命名
                    </button>
                  ) : null}
                  {canDeleteCurrentFolder ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowFolderActions(false);
                        openDeleteDialog({ kind: 'folder', id: folder.id, name: folder.name });
                      }}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除文件夹
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {uploadError ? (
        <div className="shrink-0 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {uploadError}
        </div>
      ) : null}

      {/* Upload Panel */}
      {showUploadPanel && uploadQueue.length > 0 && (
        <div className="shrink-0 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-lg">
          <div className="border-b border-slate-100 bg-slate-50/50 p-3 md:p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {pendingCount > 0 && (
                  <span className="text-slate-600">待上传: <strong>{pendingCount}</strong></span>
                )}
                {uploadingCount > 0 && (
                  <span className="text-blue-600 flex items-center">
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    上传中: <strong>{uploadingCount}</strong>
                  </span>
                )}
                {successCount > 0 && (
                  <span className="text-emerald-600 flex items-center">
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    成功: <strong>{successCount}</strong>
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="text-red-500 flex items-center">
                    <XCircle className="w-3.5 h-3.5 mr-1" />
                    失败: <strong>{failedCount}</strong>
                  </span>
                )}
                {summaryTask && (
                  <span className={`${summaryTask.status === 'failed' ? 'text-red-500' : summaryTask.status === 'partial_failed' ? 'text-amber-600' : 'text-indigo-600'} flex items-center`}>
                    {summaryTask.status === 'running' ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : summaryTask.status === 'success' ? (
                      <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                    )}
                    总结: <strong>{summaryTask.success_count}/{summaryTask.total_count}</strong>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {failedCount > 0 && !isSummaryRunning && (
                  <button
                    onClick={retryFailed}
                    className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                  >
                    重试失败项
                  </button>
                )}
                {pendingCount > 0 && !isUploading && !isSummaryRunning && (
                  <button
                    onClick={startUpload}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    开始上传
                  </button>
                )}
                {(successCount > 0 || failedCount > 0 || summaryTask) && canClosePanel && (
                  <button
                    onClick={() => {
                      if (summaryPollTimerRef.current) {
                        window.clearTimeout(summaryPollTimerRef.current);
                      }
                      setUploadQueue([]);
                      setPendingDirectoryPaths([]);
                      setUploadError(null);
                      setSummaryTask(null);
                      setShowUploadPanel(false);
                      if (successCount > 0) fetchFolderData();
                    }}
                    className="px-4 py-1.5 bg-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-300 transition-colors"
                  >
                    关闭
                  </button>
                )}
              </div>
            </div>
            {summaryTask && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-700">
                    {summaryTask.status === 'running' ? '正在批量生成总结' : '总结任务结果'}
                  </span>
                  <span>
                    {summaryTask.completed_count}/{summaryTask.total_count}，耗时 {summaryTask.elapsed_seconds}s / {summaryTask.timeout_seconds}s
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full transition-all ${summaryTask.status === 'failed' ? 'bg-red-500' : summaryTask.status === 'partial_failed' ? 'bg-amber-500' : 'bg-indigo-500'}`}
                    style={{ width: `${summaryTask.total_count > 0 ? Math.min((summaryTask.completed_count / summaryTask.total_count) * 100, 100) : 0}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>成功 {summaryTask.success_count}</span>
                  <span>失败 {summaryTask.failed_count}</span>
                  <span>处理中 {summaryTask.processing_count}</span>
                  <span>待处理 {summaryTask.pending_count}</span>
                </div>
                {summaryTask.message ? (
                  <div className={`mt-2 text-xs ${summaryTask.status === 'failed' ? 'text-red-500' : summaryTask.status === 'partial_failed' ? 'text-amber-600' : 'text-slate-500'}`}>
                    {summaryTask.message}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {uploadQueue.map(item => (
              <div key={item.id} className="flex items-center px-4 py-3 border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{item.file.name}</p>
                  <p className="text-xs text-slate-400">
                    {item.relativePath !== item.file.name && (
                      <span className="mr-2">{item.relativePath.split('/').slice(0, -1).join('/')}/</span>
                    )}
                    {formatSize(item.file.size)}
                  </p>
                  {item.error && (
                    <p className="text-xs text-red-500 mt-1">{item.error}</p>
                  )}
                </div>
                <div className="ml-4 flex items-center space-x-2">
                  {item.status === 'pending' && (
                    <span className="text-xs text-slate-400">等待中</span>
                  )}
                  {item.status === 'uploading' && (
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  )}
                  {item.status === 'success' && (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  )}
                  {item.status === 'failed' && (
                    <button
                      onClick={() => retrySingleUpload(item)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      重试
                    </button>
                  )}
                  <button
                    onClick={() => removeFromQueue(item.id)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm md:min-h-0">
        {(subfolders.length === 0 && files.length === 0) ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center md:p-16">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <File className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium mb-2">此文件夹为空</p>
            {canUploadToCurrentFolder && (
              <>
                <p className="text-sm text-slate-400 mb-6">点击下方按钮添加内容</p>
                <div className="flex flex-wrap items-center justify-center gap-2 md:space-x-1">
                  {canManageCurrentFolder ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/folders/${folder.id}/settings`)}
                      className="flex items-center rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      <Settings2 className="mr-2 h-4 w-4" />
                      编辑配置
                    </button>
                  ) : null}
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    disabled={isUploading || isSummaryRunning}
                    className="flex items-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Folder className="w-4 h-4 mr-2" />
                    上传文件夹
                  </button>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isSummaryRunning}
                    className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    上传文件
                  </button>
                </div>
              </>
            )}
            {!canUploadToCurrentFolder && <p className="text-sm text-slate-400">您没有权限添加内容</p>}
          </div>
        ) : (
          <LibraryItemsView
            items={collectionItems}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            itemCountLabel={`${subfolders.length + files.length} 个项目`}
            nameColumn={{
              label: '名称',
              onClick: () => handleSort('name'),
              direction: sortConfig.key === 'name' ? sortConfig.direction : null,
            }}
            secondaryColumn={{
              label: '类型',
              onClick: () => handleSort('file_ext'),
              direction: sortConfig.key === 'file_ext' ? sortConfig.direction : null,
            }}
            sizeColumn={{
              label: '大小',
              onClick: () => handleSort('size'),
              direction: sortConfig.key === 'size' ? sortConfig.direction : null,
            }}
            statusColumn={{ label: '状态' }}
            dateColumn={{
              label: '上传时间',
              onClick: () => handleSort('created_at'),
              direction: sortConfig.key === 'created_at' ? sortConfig.direction : null,
            }}
            gridClassName="grid gap-3 p-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))] md:gap-4 md:p-4 md:[grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))]"
          />
        )}
      </div>

      {moveTarget ? (
        <MoveResourceDialog
          resource={moveTarget}
          initialTargetFolderId={moveInitialFolderId}
          onClose={() => {
            setMoveTarget(null);
            setMoveInitialFolderId(null);
          }}
          onMoved={handleMoved}
        />
      ) : null}

      {renameTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => setRenameTarget(null)}
        >
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">重命名{renameTarget.kind === 'folder' ? '文件夹' : '文件'}</div>
              <button onClick={() => setRenameTarget(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-xs text-slate-400">名称</div>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                placeholder="请输入新名称"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitRename();
                  }
                }}
              />
              {renameTarget.kind === 'file' ? (
                <p className="text-xs text-slate-400 leading-5">不输入后缀时将保留原文件后缀。</p>
              ) : null}
            </div>
            <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setRenameTarget(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={submitRename}
                disabled={actionLoading || !renameValue.trim()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {actionLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => setDeleteTarget(null)}
        >
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">确认删除</div>
              <button onClick={() => setDeleteTarget(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-700 leading-7">
                即将删除{deleteTarget.kind === 'folder' ? '文件夹' : '文件'}：
                <span className="font-semibold text-slate-900"> {deleteTarget.name}</span>
              </p>
              {deleteTarget.kind === 'folder' ? (
                <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4 leading-7">
                  删除文件夹会同时删除其中的子文件夹与文件（逻辑删除），并从检索索引中移除。
                </div>
              ) : (
                <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4 leading-7">
                  该文件将从列表与检索中移除，无法在系统内继续访问。大小：{formatSize(deleteTarget.size)}。
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={submitDelete}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
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

export default FolderDetail;
