import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '../i18n';

/**
 * K10 (#135): подсказка о хранении в браузере (§ 25 TDDDG). Ja!sno хранит только технически необходимое
 * (только токен входа), без рекламы, аналитики и трекинга — согласие не нужно, достаточно информации.
 * Появится аналитика или внешние сервисы в браузере → нужен настоящий баннер согласия
 * («Принять» и «Отклонить» одинаково заметные, до согласия ничего не загружать).
 */
export function StorageNotice() {
  // Поправка 1 (23.11): подсказка видна при каждом запуске сайта. «Понятно» скрывает её до перезагрузки,
  // в браузере ничего не запоминается.
  const [seen, setSeen] = useState(false);
  if (seen) return null;
  const close = () => setSeen(true);
  return (
    <div className="storage-notice" role="region" aria-label={t('Cookies и хранение в браузере')} data-testid="storage-notice">
      <div className="storage-notice__text">
        <p>
          {t('Ja!sno не использует рекламу, аналитику и трекинг. В браузере хранится только то, что нужно для входа.')}
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
            {t('Анализ писем ИИ')}
          </Link>
        </p>
      </div>
      <button type="button" className="btn btn--secondary btn--small" onClick={close}>
        {t('Понятно')}
      </button>
    </div>
  );
}
