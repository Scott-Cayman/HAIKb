import api from './api';

export interface DocumentSummaryData {
  id: number;
  file_id: number;
  summary_markdown: string;
  summary_file_path?: string | null;
  one_line_judgement?: string | null;
  two_sentence_intro?: string | null;
  client_type?: string | null;
  project_type?: string | null;
  document_type?: string | null;
  region_tags?: string | null;
  industry_tags?: string | null;
  keyword_tags?: string | null;
  parse_pages?: number;
  parse_status?: string;
  parse_confidence?: string | null;
  parse_error?: string | null;
  index_status?: string;
  index_error?: string | null;
}

export interface FileSummaryResponse {
  file_id: number;
  summary_status: string;
  summary_error?: string | null;
  summary?: DocumentSummaryData | null;
}

export interface RagIndexItem {
  id: number;
  name: string;
  index_type: string;
  status: string;
  summary_count: number;
  chunk_count: number;
}

export interface RagStatusResponse {
  file_summary_stats: Record<string, number>;
  summary_index_stats: Record<string, number>;
  total_summaries: number;
  total_sources: number;
  total_chunks: number;
}

export interface SummaryTagUpdateRequest {
  client_type?: string | null;
  project_type?: string | null;
  document_type?: string | null;
  region_tags?: string[];
  industry_tags?: string[];
  keyword_tags?: string[];
}

export const ragApi = {
  getIndices: async () => {
    const response = await api.get<RagIndexItem[]>('/rag/indices');
    return response.data;
  },
  rebuildDefaultIndex: async () => {
    const response = await api.post('/rag/indices/default/rebuild');
    return response.data;
  },
  summarizeFile: async (fileId: number) => {
    const response = await api.post(`/rag/files/${fileId}/summarize`);
    return response.data;
  },
  getFileSummary: async (fileId: number) => {
    const response = await api.get<FileSummaryResponse>(`/rag/files/${fileId}/summary`);
    return response.data;
  },
  updateFileTags: async (fileId: number, payload: SummaryTagUpdateRequest) => {
    const response = await api.put<FileSummaryResponse>(`/rag/files/${fileId}/tags`, payload);
    return response.data;
  },
  reindexSummary: async (fileId: number) => {
    const response = await api.post(`/rag/files/${fileId}/reindex-summary`);
    return response.data;
  },
  getStatus: async () => {
    const response = await api.get<RagStatusResponse>('/rag/status');
    return response.data;
  },
};
