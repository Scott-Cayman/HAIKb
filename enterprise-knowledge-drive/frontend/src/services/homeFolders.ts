import api, { clearCache } from './api';

export type ResourceCapabilities = {
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

export type FolderSummary = {
  id: number;
  name: string;
  parent_id: number | null;
  description?: string | null;
  created_at?: string | null;
  created_by?: number | null;
  cover_url?: string | null;
  display_mode?: string | null;
  icon_key?: string | null;
  icon_bg_from?: string | null;
  icon_bg_to?: string | null;
  icon_color?: string | null;
  card_bg_from?: string | null;
  card_bg_via?: string | null;
  card_bg_to?: string | null;
  card_glow_color?: string | null;
  can_manage_settings: boolean;
  capabilities: ResourceCapabilities;
};

export type HomeFolderContext = {
  root_folders: FolderSummary[];
  enterprise_root: FolderSummary;
  center_folder: FolderSummary;
  pinned_folders: FolderSummary[];
  pin_candidate_folders: FolderSummary[];
};

export const formatFolderDisplayName = (value: string) =>
  value.split('智海王朝').join('智海王潮');

const normalizeFolderSummary = (folder: FolderSummary): FolderSummary => ({
  ...folder,
  name: formatFolderDisplayName(folder.name),
});

const normalizeHomeFolderContext = (context: HomeFolderContext): HomeFolderContext => ({
  ...context,
  root_folders: context.root_folders.map(normalizeFolderSummary),
  enterprise_root: normalizeFolderSummary(context.enterprise_root),
  center_folder: normalizeFolderSummary(context.center_folder),
  pinned_folders: context.pinned_folders.map(normalizeFolderSummary),
  pin_candidate_folders: context.pin_candidate_folders.map(normalizeFolderSummary),
});

export const getHomeFolderContext = async (rootFolderId?: number) => {
  const response = await api.get<HomeFolderContext>('/folders/home-context', {
    params: rootFolderId ? { root_folder_id: rootFolderId } : undefined,
  });
  return normalizeHomeFolderContext(response.data);
};

export const getFolderPinnedContext = async (folderId: number) => {
  const response = await api.get<HomeFolderContext>(`/folders/${folderId}/home-pinned-folders-context`);
  return normalizeHomeFolderContext(response.data);
};

export const updateHomePinnedFolders = async (folderId: number, folderIds: number[]) => {
  const response = await api.put<HomeFolderContext>(`/folders/${folderId}/home-pinned-folders`, {
    folder_ids: folderIds,
  });
  clearCache();
  return normalizeHomeFolderContext(response.data);
};
