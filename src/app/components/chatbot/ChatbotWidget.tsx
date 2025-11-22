import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { ApiError } from '../../../services/api';
import { sendChatMessage, type ChatMessage as ApiChatMessage } from '../../../services/chatbot';
import { useToast } from '../../../components/Toaster';

type UiRole = 'user' | 'assistant';

type UiMessage = {
  id: string;
  role: UiRole;
  content: string;
  createdAt: number;
};

type StoredState = {
  sessionId?: string;
  messages: UiMessage[];
};

const STORAGE_KEY = 'stock-console:chatbot';
const MAX_PERSISTED = 20;

const makeId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
  `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const readStoredState = (): StoredState => {
  if (typeof window === 'undefined') {
    return { messages: [] };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { messages: [] };
    }
    const parsed = JSON.parse(raw) as StoredState;
    if (!parsed || !Array.isArray(parsed.messages)) {
      return { messages: [] };
    }
    return {
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
      messages: parsed.messages.filter(
        (entry) => entry && typeof entry.content === 'string' && (entry.role === 'user' || entry.role === 'assistant'),
      ),
    };
  } catch {
    return { messages: [] };
  }
};

const persistState = (state: StoredState) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const trimmed = {
      ...state,
      messages: state.messages.slice(-MAX_PERSISTED),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors (private mode, quota exceeded, etc.)
  }
};

const ChatbotWidget: React.FC = () => {
  const location = useLocation();
  const showToast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(() => readStoredState().sessionId);
  const [messages, setMessages] = useState<UiMessage[]>(() => readStoredState().messages);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persistState({ sessionId, messages });
  }, [messages, sessionId]);

  useEffect(() => {
    if (!isOpen) return;
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const placeholderMessage = useMemo(
    () => ({
      id: 'placeholder',
      role: 'assistant' as UiRole,
      content:
        '안녕하세요! 재고/발주/예측 관련해 궁금한 점을 물어보세요.\n예) "A상품 다음 발주량 추천해줘" 또는 "이 그래프 뜻을 설명해줘"',
      createdAt: Date.now(),
    }),
    [],
  );

  const normalizedMessagesForRequest = (history: UiMessage[]): ApiChatMessage[] =>
    history
      .slice(-12)
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
      }));

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    const userMessage: UiMessage = {
      id: makeId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsSending(true);

    try {
      const response = await sendChatMessage({
        sessionId,
        messages: normalizedMessagesForRequest(nextMessages),
        context: { page: location.pathname },
      });

      setSessionId(response.sessionId);
      const reply = response.reply?.trim();
      if (reply) {
        const assistantMessage: UiMessage = {
          id: makeId(),
          role: 'assistant',
          content: reply,
          createdAt: Date.now(),
        };
        setMessages((current) => [...current, assistantMessage]);
      }
    } catch (error) {
      const fallbackMessage =
        error instanceof ApiError && error.message
          ? error.message
          : '챗봇 응답을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
      showToast(fallbackMessage, { tone: 'error' });
      const fallback: UiMessage = {
        id: makeId(),
        role: 'assistant',
        content: fallbackMessage,
        createdAt: Date.now(),
      };
      setMessages((current) => [...current, fallback]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const renderMessage = (message: UiMessage) => {
    const isUser = message.role === 'user';
    const bubbleClass = isUser
      ? 'bg-indigo-600 text-white'
      : 'bg-white text-slate-900 ring-1 ring-slate-200';
    const alignClass = isUser ? 'justify-end' : 'justify-start';
    const label = isUser ? '나' : 'AI';

    return (
      <div key={message.id} className={`flex ${alignClass} gap-2`}>
        {!isUser && (
          <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-indigo-100 text-center text-xs font-semibold leading-7 text-indigo-700">
            {label}
          </div>
        )}
        <div
          className={`max-w-[80%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm shadow-sm ${bubbleClass}`}
          aria-label={`${label} message`}
        >
          {message.content}
        </div>
        {isUser && (
          <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-slate-100 text-center text-xs font-semibold leading-7 text-slate-600">
            {label}
          </div>
        )}
      </div>
    );
  };

  const resetConversation = () => {
    setMessages([]);
    setSessionId(undefined);
    setInput('');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const handleCloseChat = () => {
    resetConversation();
    setIsOpen(false);
  };

  const handleToggle = () => {
    if (isOpen) {
      handleCloseChat();
      return;
    }

    setIsOpen(true);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {isOpen && (
        <div className="pointer-events-auto flex w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl bg-white/95 shadow-2xl ring-1 ring-slate-200 backdrop-blur sm:w-[400px]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">스마트창고 챗봇</p>
              <p className="text-xs text-slate-500">재고/발주/예측 질문을 도와드려요</p>
            </div>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
              onClick={handleCloseChat}
            >
              닫기
            </button>
          </div>

          <div
            ref={listRef}
            className="flex max-h-[60vh] flex-1 flex-col gap-3 overflow-y-auto bg-slate-50 px-4 py-4"
          >
            {(messages.length > 0 ? messages : [placeholderMessage]).map((message) => renderMessage(message))}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="무엇이든 물어보세요. Shift+Enter로 줄바꿈"
                className="mb-2 w-full resize-none border-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                rows={3}
                disabled={isSending}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  {isSending ? '답변 생성 중...' : 'Enter로 전송, Shift+Enter로 줄바꿈'}
                </p>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={isSending || !input.trim()}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    isSending || !input.trim()
                      ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                      : 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                  }`}
                >
                  보내기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleToggle}
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-xl ring-1 ring-indigo-300 transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
          ?
        </span>
        <span>{isOpen ? '챗봇 닫기' : '챗봇 열기'}</span>
      </button>
    </div>
  );
};

export default ChatbotWidget;
