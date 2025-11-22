import { post } from './api';

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ChatContext {
  page?: string;
  sku?: string;
  productName?: string;
  userId?: string;
}

export interface ChatRequestBody {
  sessionId?: string;
  messages: ChatMessage[];
  context?: ChatContext;
}

export interface ChatResponseBody {
  reply: string;
  sessionId: string;
  error?: string;
}

export function sendChatMessage(payload: ChatRequestBody) {
  return post<ChatResponseBody>('/api/chat', payload);
}
