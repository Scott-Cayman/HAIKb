import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, File, Upload, MoreVertical, CheckCircle, XCircle, Loader2, Folder, Grid, List, FileText, Image, Film, Music, Archive, PencilLine, Trash2, X } from 'lucide-react';
import api from '../services/api';
import { formatDate, formatSize } from '../utils';
import { useAuthStore } from '../stores/authStore';

interface FolderType {
  id: number;
  name: string;
  description: string;
  parent_id: number | null;
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
}

interface UploadItem {
  id: string;
  file: File;
  relativePath: string;
  status: 'pending' | 'uploading' | 'success' | 'failed';
  progress: number;
  error?: string;
}

type ViewMode = 'list' | 'grid';

type ActionTarget =
  | { kind: 'folder'; id: number; name: string }
  | { kind: 'file'; id: number; name: string; size: number };

const getFileIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'svg':
      return <Image className="w-10 h-10 text-emerald-500" />;
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'mkv':
      return <Film className="w-10 h-10 text-purple-500" />;
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
      return <Music className="w-10 h-10 text-pink-500" />;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return <Archive className="w-10 h-10 text-amber-500" />;
    case 'doc':
    case 'docx':
    case 'xls':
    case 'xlsx':
    case 'ppt':
    case 'pptx':
    case 'pdf':
    case 'txt':
      return <FileText className="w-10 h-10 text-blue-500" />;
    default:
      return <File className="w-10 h-10 text-slate-400" />;
  }
};

const FolderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canEdit = !!user?.is_admin || !!user?.is_super_admin;
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

  const fetchFolderData = async () => {
    if (!id) return;
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
    }
  };

  useEffect(() => {
    fetchFolderData();
  }, [id]);

  useEffect(() => {
    if (!openMenuKey) return;
    const onMouseDown = () => setOpenMenuKey(null);
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [openMenuKey]);

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

  const uploadFile = async (item: UploadItem): Promise<boolean> => {
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('folder_id', id || '');
    
    if (item.relativePath !== item.file.name) {
      formData.append('relative_path', item.relativePath);
    }

    try {
      setUploadQueue(prev => prev.map(u => 
        u.id === item.id ? { ...u, status: 'uploading', progress: 50 } : u
      ));
      
      await api.post('/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setUploadQueue(prev => prev.map(u => 
        u.id === item.id ? { ...u, status: 'success', progress: 100 } : u
      ));
      return true;
    } catch (error: any) {
      setUploadQueue(prev => prev.map(u => 
        u.id === item.id ? { 
          ...u, 
          status: 'failed', 
          error: error.response?.data?.detail || '上传失败' 
        } : u
      ));
      return false;
    }
  };

  const startUpload = async () => {
    const pendingItems = uploadQueue.filter(u => u.status === 'pending');
    if (pendingItems.length === 0) return;

    setIsUploading(true);

    for (const item of pendingItems) {
      await uploadFile(item);
    }

    setIsUploading(false);
    
    const failedCount = uploadQueue.filter(u => u.status === 'failed').length;
    if (failedCount === 0) {
      setTimeout(() => {
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
      u.status === 'failed' ? { ...u, status: 'pending', error: undefined } : u
    ));
  };

  const pendingCount = uploadQueue.filter(u => u.status === 'pending').length;
  const uploadingCount = uploadQueue.filter(u => u.status === 'uploading').length;
  const successCount = uploadQueue.filter(u => u.status === 'success').length;
  const failedCount = uploadQueue.filter(u => u.status === 'failed').length;

  if (!folder) return <div className="p-8 text-center text-slate-500">加载中...</div>;

  // 判断是否是二级文件夹（有 parent_id）
  const isSecondLevel = folder.parent_id !== null;

  return (
    <div className="space-y-6 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{folder.name}</h1>
        </div>
        
        <div className="flex items-center space-x-3">
          {canEdit && (
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
              {!isSecondLevel && (
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex items-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                >
                  <Folder className="w-4 h-4 mr-2" />
                  上传文件夹
                </button>
              )}
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm hover:shadow transition-all disabled:opacity-50"
              >
                <Upload className="w-4 h-4 mr-2" />
                {isUploading ? '上传中...' : '上传文件'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Upload Panel */}
      {showUploadPanel && uploadQueue.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-lg">
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
              </div>
              <div className="flex items-center space-x-2">
                {failedCount > 0 && (
                  <button
                    onClick={retryFailed}
                    className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                  >
                    重试失败项
                  </button>
                )}
                {pendingCount > 0 && !isUploading && (
                  <button
                    onClick={startUpload}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    开始上传
                  </button>
                )}
                {(successCount > 0 || failedCount > 0) && !isUploading && (
                  <button
                    onClick={() => {
                      setUploadQueue([]);
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
                      onClick={() => uploadFile(item)}
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

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        {(subfolders.length === 0 && files.length === 0) ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <File className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium mb-2">此文件夹为空</p>
            {canEdit && (
              <>
                <p className="text-sm text-slate-400 mb-6">点击下方按钮添加内容</p>
                <div className="flex items-center justify-center space-x-3">
                  {!isSecondLevel && (
                    <button 
                      onClick={() => folderInputRef.current?.click()}
                      className="flex items-center bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Folder className="w-4 h-4 mr-2" />
                      上传文件夹
                    </button>
                  )}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    上传文件
                  </button>
                </div>
              </>
            )}
            {!canEdit && <p className="text-sm text-slate-400">您没有权限添加内容</p>}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <p className="text-sm text-slate-500">{(subfolders.length + files.length)} 个项目</p>
              <div className="flex items-center space-x-1 bg-slate-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                  title="列表视图"
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                  title="宫格视图"
                >
                  <Grid className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            {viewMode === 'list' ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    <th className="p-4 font-medium">名称</th>
                    <th className="p-4 font-medium hidden sm:table-cell">大小</th>
                    <th className="p-4 font-medium hidden md:table-cell">状态</th>
                    <th className="p-4 font-medium hidden md:table-cell">上传时间</th>
                    <th className="p-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-sm">
                  {subfolders.map(subfolder => (
                    <tr key={`folder-${subfolder.id}`} onClick={() => navigate(`/folders/${subfolder.id}`)} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                      <td className="p-4 flex items-center">
                        <div className="w-8 h-8 flex items-center justify-center mr-3 bg-amber-100 rounded-lg">
                          <Folder className="w-5 h-5 text-amber-600" />
                        </div>
                        <span 
                          className="font-medium text-slate-700 group-hover:text-blue-600 transition-colors"
                          title={subfolder.name}
                        >
                          {subfolder.name}
                        </span>
                      </td>
                      <td className="p-4 text-slate-500 hidden sm:table-cell">文件夹</td>
                      <td className="p-4 text-slate-500 hidden md:table-cell">-</td>
                      <td className="p-4 text-slate-500 hidden md:table-cell">-</td>
                      <td className="p-4 text-right">
                        {canEdit && (
                          <div className="relative inline-flex">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuKey((prev) => (prev === `folder-${subfolder.id}` ? null : `folder-${subfolder.id}`));
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded-md hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenuKey === `folder-${subfolder.id}` ? (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-2 w-40 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20"
                              >
                                <button
                                  onClick={() => openRenameDialog({ kind: 'folder', id: subfolder.id, name: subfolder.name })}
                                  className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <PencilLine className="w-4 h-4 text-slate-500" />
                                  重命名
                                </button>
                                <button
                                  onClick={() => openDeleteDialog({ kind: 'folder', id: subfolder.id, name: subfolder.name })}
                                  className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  删除
                                </button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {files.map(file => (
                    <tr key={file.id} onClick={() => navigate(`/files/${file.id}`)} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                      <td className="p-4 flex items-center">
                        <div className="w-8 h-8 flex items-center justify-center mr-3">
                          {getFileIcon(file.original_name)}
                        </div>
                        <span 
                          className="font-medium text-slate-700 group-hover:text-blue-600 transition-colors truncate max-w-[200px] sm:max-w-xs"
                          title={file.original_name}
                        >
                          {file.original_name}
                        </span>
                      </td>
                      <td className="p-4 text-slate-500 hidden sm:table-cell">{formatSize(file.size)}</td>
                      <td className="p-4 text-slate-500 hidden md:table-cell">
                        {file.preview_status === 'success' && <span className="text-emerald-500 bg-emerald-50 px-2 py-1 rounded text-xs">可预览</span>}
                        {file.preview_status === 'pending' && <span className="text-amber-500 bg-amber-50 px-2 py-1 rounded text-xs">处理中</span>}
                        {file.preview_status === 'unsupported' && <span className="text-slate-500 bg-slate-100 px-2 py-1 rounded text-xs">仅下载</span>}
                      </td>
                      <td className="p-4 text-slate-500 hidden md:table-cell">{formatDate(file.created_at)}</td>
                      <td className="p-4 text-right">
                        {canEdit && (
                          <div className="relative inline-flex">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuKey((prev) => (prev === `file-${file.id}` ? null : `file-${file.id}`));
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded-md hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenuKey === `file-${file.id}` ? (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-2 w-40 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20"
                              >
                                <button
                                  onClick={() => openRenameDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
                                  className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <PencilLine className="w-4 h-4 text-slate-500" />
                                  重命名
                                </button>
                                <button
                                  onClick={() => openDeleteDialog({ kind: 'file', id: file.id, name: file.original_name, size: file.size })}
                                  className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  删除
                                </button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4">
                {subfolders.map(subfolder => (
                  <div 
                    key={`folder-${subfolder.id}`} 
                    onClick={() => navigate(`/folders/${subfolder.id}`)} 
                    className="flex flex-col items-center p-4 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                  >
                    <div className="w-16 h-16 flex items-center justify-center bg-amber-50 rounded-xl mb-3 group-hover:bg-amber-100 transition-colors">
                      <Folder className="w-10 h-10 text-amber-500" />
                    </div>
                    <p 
                      className="text-sm text-center text-slate-700 group-hover:text-blue-600 transition-colors w-full"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={subfolder.name}
                    >
                      {subfolder.name}
                    </p>
                  </div>
                ))}
                {files.map(file => (
                  <div 
                    key={file.id} 
                    onClick={() => navigate(`/files/${file.id}`)} 
                    className="flex flex-col items-center p-4 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                  >
                    <div className="relative mb-3">
                      <div className="w-16 h-16 flex items-center justify-center bg-slate-50 rounded-xl group-hover:bg-blue-50 transition-colors">
                        {getFileIcon(file.original_name)}
                      </div>
                      {file.preview_status === 'pending' && (
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
                          <Loader2 className="w-3 h-3 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                    <p 
                      className="text-sm text-center text-slate-700 group-hover:text-blue-600 transition-colors w-full"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={file.original_name}
                    >
                      {file.original_name}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">{formatSize(file.size)}</p>
                  </div>
                ))}
              </div>
            )}
          </>
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
