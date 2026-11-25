import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { errorCode } from '../../api/errors';
import { Icon } from '../../components/Icon';
import { ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { useAskChatMutation, useChatQuery, useClearChatMutation } from '../../store/api';
import { t, tMsg } from '../../i18n';

const MAX_CHARS = 1000;
const EXAMPLES = [
  t('Что такое Anmeldung и как её сделать?'),
  t('Что делать, если я не успеваю к сроку из письма?'),
  t('Где получить бесплатную консультацию?'),
];

/**
 * Чат-помощник (24.11): свободный разговор с Ja!sno, без привязки к письму.
 * Под каждым ответом пометка с сервера: не юридическая консультация, Ja!sno может ошибаться.
 */
export function AskPage() {
  const chat = useChatQuery();
  const [ask, asking] = useAskChatMutation();
  const [clear, clearing] = useClearChatMutation();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);

  const messages = chat.data?.messages ?? [];
  const disclaimer = chat.data?.disclaimer ?? '';

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending]);

  const send = async (value: string) => {
    const q = value.trim();
    if (!q || asking.isLoading) return;
    setError(null);
    setPending(q);
    setText('');
    try {
      await ask(q).unwrap();
    } catch (e) {
      setError(e);
      setText(q); // вопрос не пропадает: можно отправить ещё раз
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('Спросить Ja!sno')}
        subtitle={t('Вопросы о ведомствах, письмах, сроках и документах в Германии. Письма из кабинета помощник не читает: объяснение письма — в самом письме.')}
      />

      {chat.isLoading && <Loading />}
      {chat.isError && <ErrorAlert error={chat.error} />}

      <div className="stack chat-log" aria-live="polite" data-testid="chat-log">
        {messages.length === 0 && !pending && chat.isSuccess && (
          <div className="card stack-s">
            <p className="text-2">{t('Например:')}</p>
            <div className="row wrap" style={{ gap: 8 }}>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="chip" onClick={() => void send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'USER' ? (
            <div key={m.id} className="chat-bubble chat-bubble--me">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="chat-bubble chat-bubble--bot stack-s" data-testid="chat-answer">
              <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
              <span className="chat-disclaimer" data-testid="chat-disclaimer">
                {tMsg(disclaimer)}
              </span>
            </div>
          ),
        )}
        {pending && (
          <>
            <div className="chat-bubble chat-bubble--me">{pending}</div>
            <div className="chat-bubble chat-bubble--bot" role="status">
              {t('Ja!sno думает…')}
            </div>
          </>
        )}
        <div ref={end} />
      </div>

      {error !== null && (
        <>
          <ErrorAlert error={error} />
          {errorCode(error) === 'AI_CONSENT_REQUIRED' && (
            <Link to="/app/profile" className="link">
              {t('Дать согласие в профиле')}
            </Link>
          )}
        </>
      )}

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          className="input"
          rows={2}
          maxLength={MAX_CHARS}
          value={text}
          placeholder={t('Ваш вопрос…')}
          aria-label={t('Ваш вопрос')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter отправляет, Shift+Enter — новая строка
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <button
          type="submit"
          className="btn btn--primary btn--small"
          disabled={!text.trim() || asking.isLoading}
          aria-label={t('Отправить')}
        >
          <Icon name="send" size={18} color="#FFFFFF" />
        </button>
      </form>

      {messages.length > 0 && (
        <button
          type="button"
          className="btn btn--ghost btn--small"
          style={{ alignSelf: 'flex-start' }}
          disabled={clearing.isLoading || asking.isLoading}
          onClick={() => void clear()}
        >
          {t('Очистить разговор')}
        </button>
      )}
    </>
  );
}
