import type { ArchiveReply, ChatMessage, ChatReply, ChatView } from '../api/types';

/** Примерные данные (VITE_DATA_MODE=mock): чат без сервера, только в этой вкладке. */
export const CHAT_DISCLAIMER =
  'Это не юридическая консультация. Ja!sno может ошибаться: важное проверьте в ведомстве или на консультации.';

let messages: ChatMessage[] = [];
let n = 0;

const msg = (role: ChatMessage['role'], text: string): ChatMessage => ({
  id: `mock-chat-${++n}`,
  role,
  text,
  createdAt: new Date().toISOString(),
});

export const mockChat = {
  view(): ChatView {
    return { disclaimer: CHAT_DISCLAIMER, messages: [...messages] };
  },
  ask(text: string): ChatReply {
    const question = msg('USER', text);
    const answer = msg(
      'ASSISTANT',
      'Примерные данные: настоящего ответа нет. С сервером Ja!sno ответит по FAQ и общим знаниям о немецких ведомствах.',
    );
    messages = [...messages, question, answer];
    return { disclaimer: CHAT_DISCLAIMER, question, answer };
  },
  /** KORR 25.11: чат на главной без входа */
  askPublic(): { disclaimer: string; answer: string } {
    return {
      disclaimer: CHAT_DISCLAIMER,
      answer:
        'Примерные данные: настоящего ответа нет. С сервером Ja!sno ответит по FAQ, блогу и общим знаниям о немецких ведомствах.',
    };
  },
  clear(): void {
    messages = [];
  },
};

/** L05: вопрос к своим письмам без сервера */
export function mockArchive(): ArchiveReply {
  return {
    disclaimer: CHAT_DISCLAIMER,
    answer:
      'Примерные данные: настоящего поиска нет. С сервером Ja!sno найдёт ответ в ваших письмах и покажет цитаты.',
    sources: [],
    terms: [],
    pendingLetters: 0,
  };
}
