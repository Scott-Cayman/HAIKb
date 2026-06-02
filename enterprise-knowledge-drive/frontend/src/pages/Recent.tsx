import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { File, Clock } from 'lucide-react';
import api from '../services/api';
import FavoriteButton from '../components/FavoriteButton';
import { useFavoriteStatus } from '../hooks/useFavoriteStatus';
import { formatDate, formatSize } from '../utils';

interface FileType {
  id: number;
  original_name: string;
  size: number;
  created_at: string;
  folder_id: number;
}

const Recent = () => {
  const navigate = useNavigate();
  const [recentFiles, setRecentFiles] = useState<FileType[]>([]);
  const [fetching, setFetching] = useState(false);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
          <Clock className="w-5 h-5 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">最近访问</h1>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        {recentFiles.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {recentFiles.map(file => (
              <div 
                key={file.id}
                onClick={() => navigate(`/files/${file.id}`)}
                className="p-5 hover:bg-slate-50/50 transition-colors group cursor-pointer flex items-center"
              >
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
                  <File className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-slate-800 group-hover:text-blue-600 transition-colors truncate">
                    {file.original_name}
                  </h3>
                  <div className="flex items-center space-x-4 mt-1 text-xs text-slate-500">
                    <span>{formatSize(file.size)}</span>
                    <span>•</span>
                    <span>{formatDate(file.created_at)}</span>
                  </div>
                </div>
                <div className="ml-4 inline-flex items-center gap-3">
                  <FavoriteButton
                    active={favoriteFileIds.has(file.id)}
                    title={favoriteFileIds.has(file.id) ? '取消收藏文件' : '收藏文件'}
                    className={`w-9 h-9 ${favoriteFileIds.has(file.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    onClick={() => handleToggleFileFavorite(file.id)}
                  />
                  <button className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity font-medium text-sm">
                    查看
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-700 mb-2">暂无最近访问</h3>
            <p className="text-slate-500 text-sm">浏览或上传文件后，这里会显示最近访问记录</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Recent;
