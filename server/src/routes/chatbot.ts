import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai/error';

type ChatRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatContext {
  page?: string;
  sku?: string;
  productName?: string;
  userId?: string;
}

interface ChatbotRequestBody {
  sessionId?: string;
  messages?: ChatMessage[];
  context?: ChatContext;
}

const apiKey = process.env.OPENAI_API_KEY;
const chatClient = apiKey ? new OpenAI({ apiKey }) : null;
const OPENAI_CHAT_MODEL = (process.env.OPENAI_CHAT_MODEL || 'gpt-5').trim();
const MAX_HISTORY = 12;

const resolveChatTemperature = (model: string): number => {
  const envValue = process.env.OPENAI_CHAT_TEMPERATURE;
  if (envValue !== undefined) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) {
      return parsed;
    }
  }

  if (model.startsWith('gpt-5')) {
    return 1;
  }

  return 0.2;
};

const CHAT_TEMPERATURE = resolveChatTemperature(OPENAI_CHAT_MODEL);

const SYSTEM_PROMPT = `당신은 재고/수요/창고 운영을 돕는 한국어 전문 어시스턴트입니다.
- 재고 부족 위험, 리드타임, 서비스 수준, 발주/판매 정보를 근거로 짧고 명확하게 답변하세요.
- 추측하거나 근거 없는 수치를 만들어 내지 마세요. 데이터가 부족하면 "정보가 충분하지 않습니다"라고 말하세요.
- 안전재고, 재주문점, 서비스 수준 등 핵심 용어를 쉽게 풀어 설명하고, 필요한 경우 단계별 액션을 제안하세요.
- 답변은 3~6줄 이내로 짧게 유지하고, 불확실성이나 가정이 있으면 함께 언급하세요.`;

const buildContextPrompt = (context?: ChatContext): string => {
  if (!context) {
    return '';
  }

  const entries: string[] = [];
  if (context.page) entries.push(`현재 페이지: ${context.page}`);
  if (context.sku) entries.push(`관련 SKU: ${context.sku}`);
  if (context.productName) entries.push(`상품명: ${context.productName}`);
  if (context.userId) entries.push(`사용자: ${context.userId}`);

  if (entries.length === 0) {
    return '';
  }

  return ['다음은 사용자의 화면/상황 정보입니다.', ...entries].join('\n');
};

const normalizeMessages = (messages?: ChatMessage[]): ChatMessage[] => {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const content = typeof entry.content === 'string' ? entry.content.trim() : '';
      const role: ChatRole =
        entry.role === 'assistant' || entry.role === 'system' ? entry.role : 'user';

      if (!content) {
        return null;
      }

      return { role, content };
    })
    .filter((entry): entry is ChatMessage => entry !== null)
    .slice(-MAX_HISTORY);
};

const isLikelyNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError ||
    (error instanceof Error && /\b(network|timeout|fetch|getaddrinfo)\b/i.test(error.message ?? ''))
  ) {
    return true;
  }

  return false;
};

const extractHttpStatus = (err: unknown): number | undefined => {
  if (!err) {
    return undefined;
  }

  if (err instanceof APIError) {
    return err.status ?? undefined;
  }

  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number' && Number.isFinite(status)) {
    return status;
  }

  const statusCode = (err as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number' && Number.isFinite(statusCode)) {
    return statusCode;
  }

  return undefined;
};

export default async function chatbotRoutes(server: FastifyInstance) {
  server.post('/', async (request, reply) => {
    const body = (request.body as ChatbotRequestBody | undefined) ?? {};
    const normalizedMessages = normalizeMessages(body.messages);

    if (normalizedMessages.length === 0) {
      return reply.code(400).send({ error: 'messages 배열에 내용이 필요합니다.' });
    }

    if (!chatClient) {
      return reply
        .code(503)
        .send({ error: 'LLM 연동이 설정되지 않았습니다. OPENAI_API_KEY를 확인해주세요.' });
    }

    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : randomUUID();
    const contextPrompt = buildContextPrompt(body.context);

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      contextPrompt ? ({ role: 'system' as const, content: contextPrompt } satisfies ChatMessage) : null,
      ...normalizedMessages,
    ].filter(Boolean) as ChatMessage[];

    try {
      const completion = await chatClient.chat.completions.create({
        model: OPENAI_CHAT_MODEL,
        temperature: CHAT_TEMPERATURE,
        messages,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('LLM에서 유효한 응답을 받지 못했습니다.');
      }

      return reply.send({ reply: content, sessionId });
    } catch (error) {
      request.log.error(error, 'Failed to generate chatbot reply');
      const status = extractHttpStatus(error);

      let message: string;
      if (status === 401 || status === 403) {
        message = 'LLM API 키가 유효하지 않습니다. 서버 환경 변수 OPENAI_API_KEY를 확인해 주세요.';
      } else if (status === 429) {
        message = 'LLM 호출이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.';
      } else if (status && status >= 500) {
        message = 'LLM 서비스에 연결할 수 없습니다. 네트워크 상태나 서비스 상태를 확인해 주세요.';
      } else if (isLikelyNetworkError(error)) {
        message = 'LLM 서비스에 연결할 수 없습니다. 네트워크 상태나 서비스 상태를 확인해 주세요.';
      } else {
        message = '챗봇 응답 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      }

      return reply.code(status ?? 500).send({ error: message, sessionId });
    }
  });
}
