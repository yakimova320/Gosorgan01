import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { errorCode } from '../../api/errors';
import { Icon } from '../../components/Icon';
import { ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import {
  useAskArchiveMutation,
  useAskChatMutation,
  useChatQuery,
  useClearChatMutation,
} from '../../store/api';
import { t, tMsg } from '../../i18n';

const MAX_CHARS = 1000;
const EXAMPLES = [
  t('Что такое Anmeldung и как её сделать?'),
  t('Что делать, если я не успеваю к сроку из письма?'),
  t('Где получить бесплатную консультацию?'),
];

/** L05: два вида вопросов — общий (чат) и к своим письмам (архив). */
function AskTabs() {
  return (
    <nav className="tabs" aria-label={t('Вид вопроса')}>
      <NavLink to="/app/ask" end className="tab">
        {t('Общий вопрос')}
      </NavLink>
      <NavLink to="/app/ask/letters" className="tab" data-testid="ask-letters-tab">
        {t('По моим письмам')}
      </NavLink>
    </nav>
  );
}

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
      <AskTabs />

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

const ARCHIVE_EXAMPLES = [
  t('Что от меня хочет Jobcenter?'),
  t('Какие сроки стоят в моих письмах?'),
  t('Какие документы меня просили прислать?'),
];

/**
 * L05 (#81): вопрос к своим письмам. Сервер ищет только в письмах этого кабинета
 * и отвечает по найденным кускам, под ответом — письма-источники с точными цитатами.
 * Ответ не сохраняется: на экране последний вопрос и ответ (состояние мутации RTK Query).
 */
export function AskLettersPage() {
  const [ask, result] = useAskArchiveMutation();
  const [text, setText] = useState('');

  const send = async (value: string) => {
    const q = value.trim();
    if (!q || result.isLoading) return;
    setText('');
    try {
      await ask(q).unwrap();
    } catch {
      setText(q); // вопрос не пропадает: можно отправить ещё раз
    }
  };

  const reply = result.isSuccess ? result.data : null;
  const question = result.originalArgs;

  return (
    <>
      <PageHeader
        title={t('Спросить Ja!sno')}
        subtitle={t('Ja!sno ищет ответ только в ваших письмах в кабинете и показывает, из какого письма каждая фраза.')}
      />
      <AskTabs />

      <div className="stack chat-log" aria-live="polite" data-testid="archive-log">
        {!question && (
          <div className="card stack-s">
            <p className="text-2">{t('Например:')}</p>
            <div className="row wrap" style={{ gap: 8 }}>
              {ARCHIVE_EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="chip" onClick={() => void send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {question && <div className="chat-bubble chat-bubble--me">{question}</div>}
        {result.isLoading && (
          <div className="chat-bubble chat-bubble--bot" role="status">
            {t('Ja!sno ищет в ваших письмах…')}
          </div>
        )}
        {reply && (
          <div className="chat-bubble chat-bubble--bot stack-s" data-testid="archive-answer">
            <span style={{ whiteSpace: 'pre-wrap' }}>{reply.answer}</span>
            {reply.sources.length > 0 && (
              <div className="stack-s" data-testid="archive-sources">
                <strong className="small">{t('Из ваших писем:')}</strong>
                {reply.sources.map((s, i) => (
                  <div key={`${s.letterId}-${i}`} className="card stack-s archive-source">
                    <Link to={`/app/letters/${s.letterId}`} className="link small">
                      {s.letterTitle ?? t('Письмо')}
                      {' · '}
                      {formatDate(s.letterCreatedAt)}
                      {s.caseTitle ? ` · ${s.caseTitle}` : ''}
                    </Link>
                    <blockquote className="quote" lang="de">
                      «{s.quote}»
                    </blockquote>
                  </div>
                ))}
              </div>
            )}
            {reply.terms.length > 0 && (
              <div className="small stack-s">
                {reply.terms.map((term) => (
                  <span key={term.term}>
                    <strong lang="de">{term.term}</strong>: {term.text}
                  </span>
                ))}
                <Link to="/glossary" className="link">
                  {t('Справочник терминов')}
                </Link>
              </div>
            )}
            {reply.pendingLetters > 0 && (
              <span className="muted small">
                {t('Часть писем ещё готовится к поиску. Спросите ещё раз чуть позже.')}
              </span>
            )}
            <span className="chat-disclaimer">{tMsg(reply.disclaimer)}</span>
          </div>
        )}
      </div>

      {result.isError && (
        <>
          <ErrorAlert error={result.error} />
          {errorCode(result.error) === 'AI_CONSENT_REQUIRED' && (
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
          placeholder={t('Вопрос о ваших письмах…')}
          aria-label={t('Вопрос о ваших письмах')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <button
          type="submit"
          className="btn btn--primary btn--small"
          disabled={!text.trim() || result.isLoading}
          aria-label={t('Отправить')}
        >
          <Icon name="send" size={18} color="#FFFFFF" />
        </button>
      </form>
    </>
  );
}
