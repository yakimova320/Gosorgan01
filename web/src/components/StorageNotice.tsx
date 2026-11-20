import { useState } from 'react';
import { Link } from 'react-router';

/**
 * K10 (#135): подсказка о хранении в браузере (§ 25 TDDDG). Ja!sno хранит только технически необходимое
 * (токен входа и эту отметку), без рекламы, аналитики и трекинга — согласие не нужно, достаточно информации.
 * Появится аналитика или внешние сервисы в браузере → нужен настоящий баннер согласия
 * («Принять» и «Отклонить» одинаково заметные, до согласия ничего не загружать).
 */
export const STORAGE_NOTICE_KEY = 'jasno.storageNotice';

function readSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function StorageNotice() {
  const [seen, setSeen] = useState(readSeen);
  if (seen) return null;
  const close = () => {
    try {
      localStorage.setItem(STORAGE_NOTICE_KEY, '1');
    } catch {
      // приватный режим: подсказка просто скроется до перезагрузки
    }
    setSeen(true);
  };
  return (
    <div className="storage-notice" role="region" aria-label="Cookies и хранение в браузере" data-testid="storage-notice">
      <div className="storage-notice__text">
        <p>
          Ja!sno не использует рекламу, аналитику и трекинг. В браузере хранится только то, что нужно для входа.
        </p>
        <p lang="de" className="small">
          Wir verwenden keine Tracking- oder Werbe-Cookies, nur technisch notwendige Speicherung für die Anmeldung.
        </p>
        <p className="small">
          <Link to="/datenschutz#cookies" className="link">
            Datenschutz
          </Link>
          {' · '}
          <Link to="/datenschutz#ki" className="link">
            Анализ писем ИИ
          </Link>
        </p>
      </div>
      <button type="button" className="btn btn--secondary btn--small" onClick={close}>
        Понятно
      </button>
    </div>
  );
}
