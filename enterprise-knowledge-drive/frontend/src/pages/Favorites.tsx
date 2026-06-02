import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Folder, Loader2, Star } from 'lucide-react';

import FavoriteButton from '../components/FavoriteButton';
import { favoritesApi, type FavoriteListItem } from '../services/favorites';
import { formatDate, formatSize } from '../utils';

const formatFavoriteDate = (value?: string | null) => {
  return value ? formatDate(value) : '时间未知';
};

const Favorites = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<FavoriteListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);

  const fetchFavorites = async () => {
    setLoading(true);
    try {
      const response = await favoritesApi.getAll();
      setItems(response);
    } catch (error) {
      console.error('Failed to fetch favorites', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!fetchPromiseRef.current) {
      fetchPromiseRef.current = fetchFavorites();
    }
  }, []);

  const removeFavorite = async (item: FavoriteListItem) => {
    try {
      if (item.item_type === 'file' && item.file) {
        await favoritesApi.removeFile(item.file.id);
      }
      if (item.item_type === 'folder' && item.folder) {
        await favoritesApi.removeFolder(item.folder.id);
      }
      setItems(prev => prev.filter(current => current.favorite_id !== item.favorite_id));
    } catch (error) {
      console.error('Failed to remove favorite', error);
      alert('取消收藏失败，请稍后重试');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
            <Star className="w-5 h-5 text-amber-600 fill-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">我的收藏</h1>
            <p className="text-sm text-slate-500 mt-1">集中查看常用文件和文件夹，支持一键取消收藏。</p>
          </div>
        </div>
        <div className="text-sm text-slate-400">{items.length} 项</div>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
            正在加载收藏...
          </div>
        ) : items.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {items.map(item => {
              const isFile = item.item_type === 'file' && item.file;
              const targetId = isFile ? item.file!.id : item.folder?.id;
              const title = isFile ? item.file!.original_name : item.folder?.name || '未命名';
              const meta = isFile
                ? `${formatSize(item.file!.size)} · ${formatFavoriteDate(item.file!.created_at || item.created_at)}`
                : `${item.folder?.description || '文件夹'} · ${formatFavoriteDate(item.folder?.created_at || item.created_at)}`;

              return (
                <div
                  key={item.favorite_id}
                  onClick={() => {
                    if (!targetId) return;
                    navigate(isFile ? `/files/${targetId}` : `/folders/${targetId}`);
                  }}
                  className="p-5 hover:bg-slate-50/60 transition-colors group cursor-pointer flex items-center gap-4"
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${isFile ? 'bg-blue-50' : 'bg-amber-50'}`}>
                    {isFile ? (
                      <FileText className="w-5 h-5 text-blue-600" />
                    ) : (
                      <Folder className="w-5 h-5 text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-medium text-slate-800 group-hover:text-blue-600 transition-colors truncate">{title}</h3>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${isFile ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-700'}`}>
                        {isFile ? '文件' : '文件夹'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 truncate">{meta}</div>
                  </div>
                  <FavoriteButton
                    active={true}
                    title="取消收藏"
                    className="w-9 h-9 shrink-0"
                    onClick={() => removeFavorite(item)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Star className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-700 mb-2">暂无收藏</h3>
            <p className="text-slate-500 text-sm">在文件夹列表或文件列表中点击星标后，会显示在这里</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Favorites;
