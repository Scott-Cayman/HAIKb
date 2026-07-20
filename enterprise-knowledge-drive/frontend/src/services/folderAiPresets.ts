import api from './api';

export interface FolderAiPresetQuestion {
  id?: number;
  question: string;
  aliases: string[];
  answer: string;
  keywords: string[];
  priority: number;
  is_enabled: boolean;
  has_embedding?: boolean;
}

export interface FolderAiPreset {
  id: number;
  folder_id: number;
  name: string;
  description?: string | null;
  source_content: string;
  inherit_to_children: boolean;
  status: string;
  version: number;
  updated_at?: string | null;
  questions: FolderAiPresetQuestion[];
}

export interface FolderPresetListResponse {
  folder: { id: number; name: string; parent_id?: number | null };
  presets: FolderAiPreset[];
}

export interface OrganizePresetResponse {
  questions: FolderAiPresetQuestion[];
  source_length: number;
  chunk_count: number;
  question_count: number;
  warnings: string[];
  prompt_version: string;
}

export const folderAiPresetsApi = {
  list: async (folderId: number) => {
    const response = await api.get<FolderPresetListResponse>(`/admin/folders/${folderId}/ai-presets`);
    return response.data;
  },
  organize: async (folderId: number, sourceContent: string) => {
    const response = await api.post<OrganizePresetResponse>(
      `/admin/folders/${folderId}/ai-presets/organize`,
      { source_content: sourceContent },
      { timeout: 180000 },
    );
    return response.data;
  },
  publish: async (
    folderId: number,
    payload: {
      preset_id?: number;
      name: string;
      description?: string;
      source_content: string;
      inherit_to_children: boolean;
      questions: FolderAiPresetQuestion[];
    },
  ) => {
    const response = await api.post<FolderAiPreset>(`/admin/folders/${folderId}/ai-presets/publish`, payload, {
      timeout: 180000,
    });
    return response.data;
  },
  remove: async (folderId: number, presetId: number) => {
    await api.delete(`/admin/folders/${folderId}/ai-presets/${presetId}`);
  },
};
