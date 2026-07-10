import api from './api';

export interface PresetPromptItem {
  id: string;
  name: string;
  scope_type: 'global' | 'department';
  department_name?: string | null;
  relative_path: string;
  description?: string | null;
  sort_order: number;
  updated_at?: string | null;
  can_edit: boolean;
}

export interface PresetPromptDetail extends PresetPromptItem {
  content: string;
}

export interface CreatePresetPromptPayload {
  name: string;
  scope_type: 'global' | 'department';
  department_name?: string;
  description?: string;
  content: string;
}

export interface UpdatePresetPromptPayload {
  name?: string;
  description?: string;
  content?: string;
}

export const presetPromptsApi = {
  list: async () => {
    const response = await api.get<PresetPromptItem[]>('/admin/settings/preset-prompts');
    return response.data;
  },
  get: async (presetId: string) => {
    const response = await api.get<PresetPromptDetail>(`/admin/settings/preset-prompts/${presetId}`);
    return response.data;
  },
  create: async (payload: CreatePresetPromptPayload) => {
    const response = await api.post<PresetPromptDetail>('/admin/settings/preset-prompts', payload);
    return response.data;
  },
  update: async (presetId: string, payload: UpdatePresetPromptPayload) => {
    const response = await api.put<PresetPromptDetail>(`/admin/settings/preset-prompts/${presetId}`, payload);
    return response.data;
  },
};
