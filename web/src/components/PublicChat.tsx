import { useState } from 'react';
import { Link } from 'react-router';
import { errorText } from '../api/errors';
import { useSession } from '../store';
import { useAskPublicChatMutation } from '../store/api';
import { Icon } from './Icon';

const MAX_CHARS = 1000;
/** Сколько прошлых реплик уходит на сервер как контекст (сервер принимает до 6). */
const HISTORY = 6;
const EXAMPLES = [
  'Нужно ли продлевать ВНЖ по § 24?',
  'Что такое Anmeldung?',
  'Как подтвердить диплом?',
];

type Line = { id: number; role: 'USER' | 'ASSISTANT'; text: string };

/**
 * KORR 25.11: чат на главной. Тот же помощник, что «Спросить Ja!sno» в кабинете, но без входа:
 * разговор живёт только в этой вкладке, сервер ничего не сохраняет.
 */
export function PublicChat() {
  const { token } = useSession();
  const [ask, asking] = useAskPublicChatMutation();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const [error, setError] = useState<unknown>(null);

  const send = async (value: string) => {
    const q = value.trim();
    if (!q || asking.isLoading) return;
    setError(null);
    setText('');
    const history = lines.slice(-HISTORY).map(({ role, text: t }) => ({ role, text: t }));
    setLines((old) => [...old, { id: Date.now(), role: 'USER', text: q }]);
    try {
      const r = await ask({ text: q, history }).unwrap();
      setDisclaimer(r.disclaimer);
      setLines((old) => [...old, { id: Date.now() + 1, role: 'ASSISTANT', text: r.answer }]);
    } catch (e) {
      setError(e);
      setLines((old) => old.slice(0, -1));
      setText(q); // вопрос не пропадает: можно отправить ещё раз
    }
  };

  return (
    <section className="card stack" aria-labelledby="public-chat-title" data-testid="public-chat">
      <div className="row" style={{ gap: 10 }}>
        <Icon name="chat" color="var(--c-teal)" />
        <h2 id="public-chat-title" style={{ fontSize: 20 }}>
          Спросите Ja!sno
        </h2>
      </div>
      <p className="small text-2">
        Вопросы о ведомствах, документах и сроках в Германии. Без регистрации. Не пишите имя, адрес и номера
        документов: вопрос уходит модели ИИ (
        <Link to="/datenschutz" className="link small">
          Datenschutz
        </Link>
        ).
      </p>

      <div className="stack chat-log" aria-live="polite">
        {lines.length === 0 && (
          <div className="row wrap" style={{ gap: 8 }}>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => void send(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {lines.map((m) =>
          m.role === 'USER' ? (
            <div key={m.id} className="chat-bubble chat-bubble--me">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="chat-bubble chat-bubble--bot stack-s" data-testid="public-chat-answer">
              <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
              <span className="chat-disclaimer">{disclaimer}</span>
            </div>
          ),
        )}
        {asking.isLoading && (
          <div className="chat-bubble chat-bubble--bot" role="status">
            Ja!sno думает…
          </div>
        )}
      </div>

      {error !== null && (
        <div className="alert alert--error" role="alert">
          {errorText(error)}
        </div>
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
          placeholder="Ваш вопрос…"
          aria-label="Ваш вопрос Ja!sno"
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
          disabled={!text.trim() || asking.isLoading}
          aria-label="Отправить вопрос"
        >
          <Icon name="send" size={18} color="#FFFFFF" />
        </button>
      </form>

      {lines.length > 0 && (
        <p className="small text-2">
          {token ? (
            <>
              Разговор с сохранением —{' '}
              <Link to="/app/ask" className="link small">
                в кабинете
              </Link>
              .
            </>
          ) : (
            <>
              Пришло письмо от ведомства?{' '}
              <Link to="/register" className="link small">
                Зарегистрируйтесь
              </Link>
              : Ja!sno разберёт его по фактам и напомнит о сроке.
            </>
          )}
        </p>
      )}
    </section>
  );
}
