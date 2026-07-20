import api from './api';
import { API_BASE_URL } from './backendConfig';
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
  summary_id?: number | null;
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

export type AgentStreamEvent =
  | { type: 'start'; conversation_id: string; scope?: Record<string, any> }
  | { type: 'preset_match'; preset_match: Record<string, any> }
  | { type: 'status'; stage: string; message: string }
  | { type: 'answer_delta'; delta: string }
  | { type: 'answer_replace'; answer: string }
  | { type: 'sources'; evidence: AgentEvidenceItem[]; related_files: RelatedFileItem[]; routing?: Record<string, any>; debug_trace?: Record<string, any> }
  | { type: 'done'; conversation_id: string }
  | { type: 'error'; message: string };

type ChatPayload = {
  query: string;
  conversation_id?: string;
  top_k?: number;
  retrieval_mode?: string;
  current_folder_id?: number;
};

export const agentApi = {
  chat: async (payload: ChatPayload) => {
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
  chatStream: async (
    payload: ChatPayload,
    onEvent: (event: AgentStreamEvent) => void,
    signal?: AbortSignal,
  ) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/agent/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...payload, test_department_name: getTestDepartmentScope() }),
      signal,
    });
    if (!response.ok) {
      let message = `AI 检索失败（${response.status}）`;
      try {
        const body = await response.json();
        message = body?.detail || message;
      } catch {
        // Keep the status-based message when the body is not JSON.
      }
      throw new Error(message);
    }
    if (!response.body) throw new Error('浏览器不支持流式响应');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const block of events) {
        const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.slice(5).trim()) as AgentStreamEvent;
        onEvent(event);
        if (event.type === 'error') throw new Error(event.message);
      }
      if (done) break;
    }
  },
  getSuggestedQuestions: async (limit = 12, currentFolderId?: number) => {
    const response = await api.get<SuggestedQuestionsResponse>('/agent/suggested-questions', {
      params: {
        limit,
        test_department_name: getTestDepartmentScope(),
        current_folder_id: currentFolderId,
      },
    });
    return response.data;
  },
};
