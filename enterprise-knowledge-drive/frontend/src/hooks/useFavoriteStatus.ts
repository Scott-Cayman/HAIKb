import { useCallback, useState } from 'react';

import { favoritesApi } from '../services/favorites';

const toSet = (ids: number[]) => new Set(ids);

export const useFavoriteStatus = () => {
  const [favoriteFileIds, setFavoriteFileIds] = useState<Set<number>>(new Set());
  const [favoriteFolderIds, setFavoriteFolderIds] = useState<Set<number>>(new Set());

  const loadFavoriteStatus = useCallback(async (params: { fileIds?: number[]; folderIds?: number[] }) => {
    const response = await favoritesApi.getStatus(params);
    setFavoriteFileIds(toSet(response.favorite_file_ids));
    setFavoriteFolderIds(toSet(response.favorite_folder_ids));
  }, []);

  const toggleFileFavorite = useCallback(async (fileId: number) => {
    const isFavorite = favoriteFileIds.has(fileId);
    if (isFavorite) {
      await favoritesApi.removeFile(fileId);
      setFavoriteFileIds(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      return false;
    }

    await favoritesApi.addFile(fileId);
    setFavoriteFileIds(prev => new Set(prev).add(fileId));
    return true;
  }, [favoriteFileIds]);

  const toggleFolderFavorite = useCallback(async (folderId: number) => {
    const isFavorite = favoriteFolderIds.has(folderId);
    if (isFavorite) {
      await favoritesApi.removeFolder(folderId);
      setFavoriteFolderIds(prev => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      return false;
    }

    await favoritesApi.addFolder(folderId);
    setFavoriteFolderIds(prev => new Set(prev).add(folderId));
    return true;
  }, [favoriteFolderIds]);

  return {
    favoriteFileIds,
    favoriteFolderIds,
    loadFavoriteStatus,
    toggleFileFavorite,
    toggleFolderFavorite,
  };
};
