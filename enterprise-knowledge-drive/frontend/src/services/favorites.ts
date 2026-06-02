import api from './api';

export interface FavoriteFolderData {
  id: number;
  name: string;
  description?: string | null;
  parent_id?: number | null;
  created_at?: string | null;
}

export interface FavoriteFileData {
  id: number;
  original_name: string;
  size: number;
  folder_id?: number | null;
  preview_status: string;
  created_at?: string | null;
}

export interface FavoriteListItem {
  favorite_id: number;
  item_type: 'file' | 'folder';
  created_at?: string | null;
  file?: FavoriteFileData | null;
  folder?: FavoriteFolderData | null;
}

export interface FavoriteStatusResponse {
  favorite_file_ids: number[];
  favorite_folder_ids: number[];
}

const joinIds = (ids: number[]) => ids.join(',');

export const favoritesApi = {
  getAll: async () => {
    const response = await api.get<FavoriteListItem[]>('/favorites');
    return response.data;
  },

  getStatus: async (params: { fileIds?: number[]; folderIds?: number[] }) => {
    const response = await api.get<FavoriteStatusResponse>('/favorites/status', {
      params: {
        file_ids: joinIds(params.fileIds || []),
        folder_ids: joinIds(params.folderIds || []),
      },
    });
    return response.data;
  },

  addFile: async (fileId: number) => {
    await api.post(`/favorites/files/${fileId}`);
  },

  removeFile: async (fileId: number) => {
    await api.delete(`/favorites/files/${fileId}`);
  },

  addFolder: async (folderId: number) => {
    await api.post(`/favorites/folders/${folderId}`);
  },

  removeFolder: async (folderId: number) => {
    await api.delete(`/favorites/folders/${folderId}`);
  },
};
