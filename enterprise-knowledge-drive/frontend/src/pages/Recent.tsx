import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';

import api from '../services/api';
import LibraryItemsView from '../components/library/LibraryItemsView';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { formatDate, formatSize } from '../utils';
import type { CollectionItem, CollectionViewMode } from '../components/library/types';

interface FileType {
  id: number;
  original_name: string;
  size: number;
  created_at: string;
  folder_id: number | null;
  preview_status?: string | null;
  file_ext?: string | null;
}

const Recent = () => {
  const navigate = useNavigate();
  const [recentFiles, setRecentFiles] = useState<FileType[]>([]);
  const [fetching, setFetching] = useState(false);
  const [viewMode, setViewMode] = useState<CollectionViewMode>('grid');
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const { favoriteFileIds, loadFavoriteStatus, toggleFileFavorite } = useFavoriteStatus();

  const fetchRecentFiles = async () => {
    if (fetching) return;
    setFetching(true);
    try {
      const response = await api.get('/files/recent');
      setRecentFiles(response.data);
    } catch (error) {
      console.error('Failed to fetch recent files', error);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!fetchPromiseRef.current) {
      fetchPromiseRef.current = fetchRecentFiles();
    }
  }, []);

  useEffect(() => {
    const fileIds = recentFiles.map(file => file.id);
    if (fileIds.length === 0) return;

    loadFavoriteStatus({ fileIds }).catch((error) => {
      console.error('Failed to load favorite status', error);
    });
  }, [recentFiles, loadFavoriteStatus]);

  const handleToggleFileFavorite = async (fileId: number) => {
    try {
      await toggleFileFavorite(fileId);
    } catch (error) {
      console.error('Failed to toggle file favorite', error);
      alert('更新文件收藏失败，请稍后重试');
    }
  };

  const items = useMemo<CollectionItem[]>(
    () =>
      recentFiles.map((file) => ({
        kind: 'file',
        id: file.id,
        name: file.original_name,
        onOpen: () => navigate(`/files/${file.id}`),
        sizeLabel: formatSize(file.size),
        dateLabel: formatDate(file.created_at),
        previewStatus: file.preview_status,
        fileExt: file.file_ext,
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
      })),
    [favoriteFileIds, navigate, recentFiles],
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
          <Clock className="w-5 h-5 text-blue-600" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">最近访问</h1>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <LibraryItemsView
          items={items}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          itemCountLabel={`${recentFiles.length} 个项目`}
          sizeColumn={{ label: '大小' }}
          dateColumn={{ label: '访问时间' }}
          emptyState={
            <div className="p-8 text-center md:p-12">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-medium text-slate-700 mb-2">暂无最近访问</h3>
              <p className="text-slate-500 text-sm">浏览或上传文件后，这里会显示最近访问记录</p>
            </div>
          }
        />
      </div>
    </div>
  );
};

export default Recent;
