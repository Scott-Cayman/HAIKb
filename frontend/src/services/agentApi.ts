import api from './api';

export interface AgentEvidenceItem {
  summary_id: number;
  file_id: number;
  chunk_id: string;
  content: string;
  score: number;
  file_name?: string;
}

export interface RelatedFileItem {
  file_id: number;
  summary_id: number;
  original_name: string;
  one_line_judgement: string;
  score: number;
  preview_url: string;
  download_url: string;
}

export interface AgentChatResponse {
  conversation_id: string;
  answer: string;
  evidence: AgentEvidenceItem[];
  related_files: RelatedFileItem[];
}

export const agentApi = {
  chat: async (payload: { query: string; conversation_id?: string; top_k?: number; retrieval_mode?: string }) => {
    const response = await api.post<AgentChatResponse>('/agent/chat', payload, { timeout: 60000 });
    return response.data;
  },
};
