import api from './api';
import { getTestDepartmentScope } from './testDepartmentScope';

export type KeywordSearchFile = {
  file_id: number;
  summary_id?: number | null;
  original_name: string;
  one_line_judgement: string;
  score: number;
  preview_url: string;
  download_url: string;
  folder_id?: number | null;
  folder_name?: string | null;
  folder_path?: string | null;
  file_ext?: string | null;
  preview_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  size?: number | null;
  matched_fields: string[];
  match_excerpt?: string | null;
};

export type KeywordSearchResponse = {
  query: string;
  tokens: string[];
  total: number;
  results: KeywordSearchFile[];
  elapsed_ms: number;
};

export const keywordSearchApi = {
  search: async (query: string, currentFolderId?: number, limit = 500) => {
    const response = await api.get<KeywordSearchResponse>('/files/keyword-search', {
      params: {
        q: query,
        limit,
        current_folder_id: currentFolderId,
        test_department_name: getTestDepartmentScope(),
      },
    });
    return response.data;
  },
};
