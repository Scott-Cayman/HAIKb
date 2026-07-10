import api from './api';
import { getTestDepartmentScope } from './testDepartmentScope';

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
  folder_id?: number | null;
}

export interface AgentChatResponse {
  conversation_id: string;
  answer: string;
  evidence: AgentEvidenceItem[];
  related_files: RelatedFileItem[];
  routing?: Record<string, any>;
  debug_trace?: Record<string, any>;
}

export interface SuggestedQuestionsResponse {
  questions: string[];
}

export const agentApi = {
  chat: async (payload: { query: string; conversation_id?: string; top_k?: number; retrieval_mode?: string }) => {
    const response = await api.post<AgentChatResponse>(
      '/agent/chat',
      {
        ...payload,
        test_department_name: getTestDepartmentScope(),
      },
      { timeout: 600000 },
    );
    return response.data;
  },
  getSuggestedQuestions: async (limit = 12) => {
    const response = await api.get<SuggestedQuestionsResponse>('/agent/suggested-questions', {
      params: {
        limit,
        test_department_name: getTestDepartmentScope(),
      },
    });
    return response.data;
  },
};
