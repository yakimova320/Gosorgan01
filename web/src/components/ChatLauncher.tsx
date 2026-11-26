import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { setChatOpen, useChatOpen } from '../lib/disclosure';
import { Icon } from './Icon';
import { PublicChat } from './PublicChat';
import { t } from '../i18n';

/**
 * UX 26.11 (#168): плавающая кнопка чата внизу справа на всех страницах.
 * Окно: на компьютере ~380×560, на телефоне на весь экран. Esc закрывает, фокус возвращается на кнопку.
 * Внутри тот же PublicChat: запросы и логика не меняются. Разговор не теряется, пока открыта вкладка.
 * На /app/ask кнопки нет: там свой чат кабинета.
 */
export function ChatLauncher({ inCabinet = false }: { inCabinet?: boolean }) {
  const open = useChatOpen();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const { pathname } = useLocation();
  const hidden = pathname.startsWith('/app/ask');

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) buttonRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChatOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // при уходе со страницы окно не висит открытым поверх нового экрана
  useEffect(() => () => setChatOpen(false), []);

  if (hidden) return null;
  return (
    <div className={inCabinet ? 'chat-launcher chat-launcher--cabinet' : 'chat-launcher'}>
      <div
        id="chat-panel"
        className="chat-panel"
        role="dialog"
        aria-labelledby="chat-panel-title"
        hidden={!open}
        data-testid="chat-panel"
      >
        {open && <PublicChat onClose={() => setChatOpen(false)} titleId="chat-panel-title" />}
      </div>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          className="chat-fab"
          aria-expanded={open}
          aria-controls="chat-panel"
          onClick={() => setChatOpen(true)}
          data-testid="chat-launcher"
        >
          <Icon name="chat" size={22} color="#FFFFFF" width={2.1} />
          <span>{t('Спроси Ja!sno')}</span>
        </button>
      )}
    </div>
  );
}
