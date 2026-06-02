import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Folder, File, MoreVertical, LayoutGrid, List, Plus, PencilLine, Trash2, X } from 'lucide-react';
import api from '../services/api';
import FavoriteButton from '../components/FavoriteButton';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
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
  folder_id: number;
}

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
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const { favoriteFileIds, favoriteFolderIds, loadFavoriteStatus, toggleFileFavorite, toggleFolderFavorite } = useFavoriteStatus();

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
    const folderIds = folders.map(folder => folder.id);
    const fileIds = recentFiles.map(file => file.id);
    if (folderIds.length === 0 && fileIds.length === 0) return;

    loadFavoriteStatus({ folderIds, fileIds }).catch((error) => {
      console.error('Failed to load favorite status', error);
    });
  }, [folders, recentFiles, loadFavoriteStatus]);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">企业资料</h1>
        <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            onMouseDown={(e) => e.stopPropagation()}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'grid' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            onMouseDown={(e) => e.stopPropagation()}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {sortedFolders.map(folder => (
            <div 
              key={folder.id}
              onClick={() => navigate(`/folders/${folder.id}`)}
              className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Folder className="w-6 h-6 text-blue-500 fill-blue-500/20" />
                </div>
                <div className="flex items-center gap-2">
                  <FavoriteButton
                    active={favoriteFolderIds.has(folder.id)}
                    title={favoriteFolderIds.has(folder.id) ? '取消收藏文件夹' : '收藏文件夹'}
                    className={`w-9 h-9 ${getFavoriteButtonVisibility(favoriteFolderIds.has(folder.id))}`}
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
                        className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                      {openMenuId === folder.id ? (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="absolute right-0 mt-2 w-40 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20"
                        >
                          <button
                            type="button"
                            onClick={() => openRename(folder)}
                            className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                          >
                            <PencilLine className="w-4 h-4 text-slate-500" />
                            重命名
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setDeleteFolder(folder);
                            }}
                            className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            删除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
              <h3 className="font-semibold text-slate-800 mb-1 group-hover:text-blue-600 transition-colors">{folder.name}</h3>
              <div className="flex items-center text-xs text-slate-400 space-x-3">
                <span>{folder.description || '无描述'}</span>
              </div>
            </div>
          ))}

          {canEdit && !isCreatingFolder && (
            <div 
              onClick={() => setIsCreatingFolder(true)}
              className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all flex flex-col items-center justify-center group cursor-pointer border-dashed border-2 min-h-[140px]"
            >
              <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3 group-hover:bg-blue-50 transition-colors">
                <Plus className="w-6 h-6 text-slate-400 group-hover:text-blue-500 transition-colors" />
              </div>
              <span className="text-sm font-medium text-slate-500 group-hover:text-blue-600 transition-colors">新建文件夹</span>
            </div>
          )}
          {canEdit && isCreatingFolder && (
            <form 
              onSubmit={handleCreateFolder}
              className="bg-white p-5 rounded-2xl border border-blue-200 shadow-sm transition-all flex flex-col justify-center min-h-[140px]"
            >
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="文件夹名称"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3 text-sm"
              />
              <div className="flex justify-end space-x-2">
                <button 
                  type="button" 
                  onClick={() => setIsCreatingFolder(false)}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 transition-colors"
                >
                  创建
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="text-sm text-slate-500">文件夹列表</div>
            {canEdit && !isCreatingFolder ? (
              <button
                type="button"
                onClick={() => setIsCreatingFolder(true)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                新建文件夹
              </button>
            ) : null}
          </div>
          {canEdit && isCreatingFolder ? (
            <form onSubmit={handleCreateFolder} className="p-4 border-b border-slate-100 flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="文件夹名称"
                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
              />
              <button
                type="button"
                onClick={() => setIsCreatingFolder(false)}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                创建
              </button>
            </form>
          ) : null}
          {folders.length ? (
            <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    <th className="p-4 font-medium cursor-pointer hover:text-slate-600 select-none" onClick={() => handleFolderSort('name')}>
                      名称 {folderSortConfig.key === 'name' && (folderSortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="p-4 font-medium hidden md:table-cell cursor-pointer hover:text-slate-600 select-none" onClick={() => handleFolderSort('description')}>
                      描述 {folderSortConfig.key === 'description' && (folderSortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="p-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-sm">
                  {sortedFolders.map((folder, idx) => {
                      const isLastItem = idx === sortedFolders.length - 1;
                    return (
                    <tr key={folder.id} onClick={() => navigate(`/folders/${folder.id}`)} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                      <td className="p-4">
                        <div className="flex items-center">
                          <Folder className="w-5 h-5 text-blue-500 mr-3" />
                          <span className="font-medium text-slate-700 group-hover:text-blue-600 transition-colors">{folder.name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-slate-500 hidden md:table-cell">{folder.description || '无描述'}</td>
                      <td className="p-4 text-right">
                        <div className="relative inline-flex items-center gap-2">
                          <FavoriteButton
                            active={favoriteFolderIds.has(folder.id)}
                            title={favoriteFolderIds.has(folder.id) ? '取消收藏文件夹' : '收藏文件夹'}
                            className={`w-9 h-9 ${getFavoriteButtonVisibility(favoriteFolderIds.has(folder.id))}`}
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
                                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <MoreVertical className="w-5 h-5" />
                              </button>
                              {openMenuId === folder.id ? (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className={`absolute right-0 w-40 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-20 ${isLastItem ? 'bottom-full mb-1' : 'top-full mt-1'}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => openRename(folder)}
                                    className="w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <PencilLine className="w-4 h-4 text-slate-500" />
                                    重命名
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setDeleteFolder(folder);
                                    }}
                                    className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    删除
                                  </button>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-slate-500">暂无文件夹</div>
          )}
        </div>
      )}
      
      <div className="pt-8">
        <h2 className="text-lg font-bold text-slate-800 mb-4">最近更新的文件</h2>
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
          {recentFiles.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                  <th className="p-4 font-medium cursor-pointer hover:text-slate-600 select-none" onClick={() => handleFilesSort('original_name')}>
                    名称 {filesSortConfig.key === 'original_name' && (filesSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="p-4 font-medium">所属文件夹</th>
                  <th className="p-4 font-medium hidden sm:table-cell cursor-pointer hover:text-slate-600 select-none" onClick={() => handleFilesSort('size')}>
                    大小 {filesSortConfig.key === 'size' && (filesSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="p-4 font-medium hidden md:table-cell cursor-pointer hover:text-slate-600 select-none" onClick={() => handleFilesSort('created_at')}>
                    更新时间 {filesSortConfig.key === 'created_at' && (filesSortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="p-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-sm">
                {sortedRecentFiles.map(file => (
                  <tr key={file.id} onClick={() => navigate(`/files/${file.id}`)} className="hover:bg-slate-50/50 transition-colors group cursor-pointer">
                    <td className="p-4 flex items-center">
                      <File className="w-5 h-5 text-blue-500 mr-3" />
                      <span className="font-medium text-slate-700 group-hover:text-blue-600 transition-colors truncate max-w-[200px] sm:max-w-xs">{file.original_name}</span>
                    </td>
                    <td className="p-4 text-slate-500">
                      <Link to={`/folders/${file.folder_id}`} onClick={(e) => e.stopPropagation()} className="hover:text-blue-600 transition-colors">
                        文件夹 {file.folder_id}
                      </Link>
                    </td>
                    <td className="p-4 text-slate-500 hidden sm:table-cell">{formatSize(file.size)}</td>
                    <td className="p-4 text-slate-500 hidden md:table-cell">{formatDate(file.created_at)}</td>
                    <td className="p-4 text-right">
                      <div className="inline-flex items-center gap-3">
                        <FavoriteButton
                          active={favoriteFileIds.has(file.id)}
                          title={favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件'}
                          className={`w-9 h-9 ${getFavoriteButtonVisibility(favoriteFileIds.has(file.id))}`}
                          onClick={() => handleToggleFileFavorite(file.id)}
                        />
                        <button className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity font-medium">查看</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-slate-500">
              暂无近期更新的文件
            </div>
          )}
        </div>
      </div>

      {renameFolder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setRenameFolder(null)}>
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">重命名文件夹</div>
              <button onClick={() => setRenameFolder(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
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
            </div>
            <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setRenameFolder(null)}
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

      {deleteFolder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setDeleteFolder(null)}>
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">确认删除</div>
              <button onClick={() => setDeleteFolder(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-700 leading-7">
                即将删除文件夹：<span className="font-semibold text-slate-900">{deleteFolder.name}</span>
              </p>
              <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4 leading-7">
                删除文件夹会同时删除其中的子文件夹与文件（逻辑删除），并从检索索引中移除。
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteFolder(null)}
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

export default Home;
