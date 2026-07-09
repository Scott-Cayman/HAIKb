import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, File, Upload, MoreVertical, CheckCircle, XCircle, Loader2, Folder, PencilLine, Trash2, X, Settings2 } from 'lucide-react';
import api, { LONG_TIMEOUT } from '../services/api';
import { ragApi, type BatchSummaryTaskResponse } from '../services/ragApi';
import FavoriteButton from '../components/FavoriteButton';
import LibraryItemsView from '../components/library/LibraryItemsView';
import type { CollectionItem } from '../components/library/types';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { formatDate, formatSize } from '../utils';
import { useAuthStore } from '../stores/authStore';

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
}

interface FileType {
  id: number;
  original_name: string;
  size: number;
  created_at: string;
  preview_status: string;
  folder_id: number | null;
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

type ViewMode = 'list' | 'grid';

type ActionTarget =
  | { kind: 'folder'; id: number; name: string }
  | { kind: 'file'; id: number; name: string; size: number };

const FolderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canManageFiles = !!user?.is_admin || !!user?.is_super_admin;
  const [folder, setFolder] = useState<FolderType | null>(null);
  const [subfolders, setSubfolders] = useState<SubFolder[]>([]);
  const [files, setFiles] = useState<FileType[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ActionTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ActionTarget | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [summaryTask, setSummaryTask] = useState<BatchSummaryTaskResponse | null>(null);
  const summaryPollTimerRef = useRef<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'original_name' | 'size' | 'created_at'; direction: 'asc' | 'desc' }>({
    key: 'name',
    direction: 'asc'
  });
  const [fetching, setFetching] = useState(false);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const lastFetchedIdRef = useRef<string | null>(null);
  const { favoriteFileIds, favoriteFolderIds, loadFavoriteStatus, toggleFileFavorite, toggleFolderFavorite } = useFavoriteStatus();

  const fetchFolderData = async () => {
    if (!id || fetching) return;
    setFetching(true);
    try {
      const [folderRes, subfoldersRes, filesRes] = await Promise.all([
        api.get(`/folders/${id}`),
        api.get(`/folders?parent_id=${id}`),
        api.get(`/files/folder/${id}`)
      ]);
      setFolder(folderRes.data);
      setSubfolders(subfoldersRes.data);
      setFiles(filesRes.data);
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

  const processFiles = useCallback((items: FileList | File[]) => {
    const newItems: UploadItem[] = Array.from(items).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file: file as File,
      relativePath: (file as any).webkitRelativePath || file.name,
      status: 'pending' as const,
      progress: 0,
    }));

    setUploadQueue(prev => [...prev, ...newItems]);
    setShowUploadPanel(true);
    return newItems;
  }, []);

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
        u.id === item.id ? { ...u, status: 'uploading', progress: 50 } : u
      ));
      
      const response = await api.post('/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: LONG_TIMEOUT,
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
    if (pendingItems.length === 0) return;

    setIsUploading(true);
    setSummaryTask(null);
    const uploadedFileIds: number[] = [];

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

  const handleSort = (key: 'name' | 'original_name' | 'size' | 'created_at') => {
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
    
    if (sortConfig.key === 'original_name') {
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
      menu: subfolder.can_manage_settings ? (
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
              <button
                type="button"
                onClick={() => navigate(`/folders/${subfolder.id}/settings`)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <PencilLine className="h-4 w-4 text-slate-500" />
                编辑配置
              </button>
              <button
                type="button"
                onClick={() => openDeleteDialog({ kind: 'folder', id: subfolder.id, name: subfolder.name })}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            </div>
          ) : null}
        </div>
      ) : null,
    };
  });

  const fileCollectionItems: CollectionItem[] = sortedFiles.map((file, idx) => {
    const isLastItem = idx === sortedFiles.length - 1;

    return {
      kind: 'file',
      id: file.id,
      name: file.original_name,
      onOpen: () => navigate(`/files/${file.id}`),
      sizeLabel: formatSize(file.size),
      dateLabel: formatDate(file.created_at),
      previewStatus: file.preview_status,
      statusLabel:
        file.preview_status === 'success'
          ? '可预览'
          : file.preview_status === 'pending'
            ? '处理中'
            : '仅下载',
      statusTone:
        file.preview_status === 'success'
          ? 'success'
          : file.preview_status === 'pending'
            ? 'warning'
            : 'neutral',
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
      menu: canManageFiles ? (
        <div className="relative">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpenMenuKey((prev) => (prev === `file-${file.id}` ? null : `file-${file.id}`));
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="rounded-full p-2 text-slate-400 opacity-0 transition-colors hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {openMenuKey === `file-${file.id}` ? (
            <div
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              className={`absolute right-0 z-20 w-40 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_30px_rgba(188,199,220,0.25)] ${isLastItem ? 'bottom-full mb-1' : 'top-full mt-1'}`}
            >
              <button
                type="button"
                onClick={() => openRenameDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <PencilLine className="h-4 w-4 text-slate-500" />
                重命名
              </button>
              <button
                type="button"
                onClick={() => openDeleteDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            </div>
          ) : null}
        </div>
      ) : null,
    };
  });

  const collectionItems: CollectionItem[] = [...folderCollectionItems, ...fileCollectionItems];

  if (!folder) return <div className="p-8 text-center text-slate-500">加载中...</div>;

  // 判断是否是二级文件夹（有 parent_id）
  const isSecondLevel = folder.parent_id !== null;

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-6">
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{folder.name}</h1>
          <FavoriteButton
            active={favoriteFolderIds.has(folder.id)}
            title={favoriteFolderIds.has(folder.id) ? '取消收藏当前文件夹' : '收藏当前文件夹'}
            className="w-10 h-10"
            onClick={() => handleToggleFolderFavorite(folder.id)}
          />
        </div>
        
        <div className="flex items-center space-x-3">
          {canManageFiles && (
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
              {folder.can_manage_settings ? (
                <button
                  type="button"
                  onClick={() => navigate(`/folders/${folder.id}/settings`)}
                  className="flex items-center rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-200"
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  编辑配置
                </button>
              ) : null}
              {!isSecondLevel && (
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isUploading || isSummaryRunning}
                  className="flex items-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                >
                  <Folder className="w-4 h-4 mr-2" />
                  上传文件夹
                </button>
              )}
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
          {!canManageFiles && folder.can_manage_settings ? (
            <button
              type="button"
              onClick={() => navigate(`/folders/${folder.id}/settings`)}
              className="flex items-center rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-200"
            >
              <Settings2 className="mr-2 h-4 w-4" />
              编辑配置
            </button>
          ) : null}
        </div>
      </div>

      {/* Upload Panel */}
      {showUploadPanel && uploadQueue.length > 0 && (
        <div className="shrink-0 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4 text-sm">
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
              <div className="flex items-center space-x-2">
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

      <div className="min-h-0 flex flex-1 flex-col bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        {(subfolders.length === 0 && files.length === 0) ? (
          <div className="flex flex-1 flex-col items-center justify-center p-16 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <File className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium mb-2">此文件夹为空</p>
            {canManageFiles && (
              <>
                <p className="text-sm text-slate-400 mb-6">点击下方按钮添加内容</p>
                <div className="flex items-center justify-center space-x-3">
                  {folder.can_manage_settings ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/folders/${folder.id}/settings`)}
                      className="flex items-center rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      <Settings2 className="mr-2 h-4 w-4" />
                      编辑配置
                    </button>
                  ) : null}
                  {!isSecondLevel && (
                    <button 
                      onClick={() => folderInputRef.current?.click()}
                      disabled={isUploading || isSummaryRunning}
                      className="flex items-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Folder className="w-4 h-4 mr-2" />
                      上传文件夹
                    </button>
                  )}
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
            {!canManageFiles && <p className="text-sm text-slate-400">您没有权限添加内容</p>}
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
            secondaryColumn={false}
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
            gridClassName="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          />
        )}
      </div>

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
