import { Link } from 'react-router';
import { PageHeader } from '../../components/ui';
import { AI_CONSENT_DETAILS, AI_CONSENT_LABEL, AI_CONSENT_LABEL_DE } from '../../lib/consent';
import { OPERATOR } from '../../lib/legal';
import { t } from '../../i18n';

/**
 * K11 (#134): страница Datenschutz. Черновик команды для тестовой версии: юридически не проверен,
 * перед публикацией текст проверяет человек и дополняет данные ответственного (Verantwortlicher).
 */
export function PrivacyPage() {
  return (
    <>
      <PageHeader title="Datenschutz" subtitle={t('Какие данные обрабатывает Ja!sno и зачем. Тестовая версия.')} />
      <div className="alert alert--warn" role="note">
        {t('Черновик для тестовой версии. Текст ещё не проверен юристом. Загружайте только примеры писем.')}
      </div>

      <section className="card stack-s">
        <h2>{t('Кто отвечает (Verantwortlicher)')}</h2>
        <OperatorBlock />
        <p className="small text-2">
          {t('Данные в квадратных скобках — заглушки.')}{' '}<Link to="/impressum" className="link">Impressum</Link>
        </p>
      </section>

      <section className="card stack-s">
        <h2>{t('Какие данные')}</h2>
        <ul className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('Аккаунт: e-mail, пароль (хранится только в виде хэша), имя, фамилия, адрес, номера из профиля.')}</li>
          <li>{t('Письма: файлы и фото, распознанный текст, факты, дела, сроки, черновики ответов.')}</li>
          <li>{t('Журнал обращений к модели ИИ: что отправлено и что получено, личные номера заменены метками.')}</li>
        </ul>
      </section>

      <section className="card stack-s" id="ki">
        <h2>{t('Анализ писем ИИ (отдельное согласие)')}</h2>
        <p>{AI_CONSENT_LABEL}</p>
        <p lang="de" className="small text-2">
          {AI_CONSENT_LABEL_DE}
        </p>
        <ul className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
          {AI_CONSENT_DETAILS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="small">
          {t('Основание: согласие (Art. 6 Abs. 1 lit. a DSGVO). Без согласия аккаунт работает, но новое письмо загрузить и разобрать нельзя.')}
        </p>
      </section>

      <section className="card stack-s" id="cookies">
        <h2>{t('Cookies и хранение в браузере')}</h2>
        <p>
          {t('Ja!sno не использует рекламу, аналитику и трекинг. В браузере хранится только то, что нужно для работы: токен входа. Подсказка о хранении ничего не запоминает и показывается при каждом запуске. Это технически необходимо (§ 25 Abs. 2 TDDDG), согласие для этого не требуется.')}
        </p>
      </section>

      <section className="card stack-s">
        <h2>{t('Сколько хранится и как удалить')}</h2>
        <ul className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('Письмо можно удалить в любой момент: вместе с файлами и фактами.')}</li>
          <li>
            {t('«Удалить аккаунт» в профиле удаляет всё: аккаунт, письма, файлы, дела и журнал обращений к модели.')}
          </li>
          <li>{t('Аккаунт без входа дольше 360 дней удаляется автоматически.')}</li>
        </ul>
      </section>

      <section className="card stack-s">
        <h2>{t('Ваши права')}</h2>
        <p>
          {t('Узнать, исправить или удалить свои данные, ограничить обработку, получить данные, отозвать согласие (Art. 15–21 DSGVO), пожаловаться в надзорный орган по защите данных.')}
        </p>
        <Link to="/app/profile" className="link">
          {t('Профиль: согласие на анализ ИИ и удаление аккаунта')}
        </Link>
      </section>
    </>
  );
}

function OperatorBlock() {
  return (
    <address className="stack-s" style={{ fontStyle: 'normal' }} data-testid="operator">
      <span>{OPERATOR.name}</span>
      <span>{OPERATOR.street}</span>
      <span>{OPERATOR.city}</span>
      <span>E-Mail: {OPERATOR.email}</span>
      <span>{t('Телефон:')}{' '}{OPERATOR.phone}</span>
    </address>
  );
}

/** Поправка 2 (23.11): Impressum. Черновик с заглушками, данные вписывает команда, проверяет юрист. */
export function ImpressumPage() {
  return (
    <>
      <PageHeader title="Impressum" subtitle={t('Кто отвечает за Ja!sno. Тестовая версия.')} />
      <div className="alert alert--warn" role="note">
        {t('Черновик для тестовой версии. Данные в квадратных скобках ещё не заполнены, текст не проверен юристом.')}
      </div>
      <section className="card stack-s" lang="de">
        <h2>Angaben gemäß § 5 DDG</h2>
        <OperatorBlock />
      </section>
      <section className="card stack-s" lang="de">
        <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p>
          {OPERATOR.name}, {OPERATOR.street}, {OPERATOR.city}
        </p>
      </section>
      <section className="card stack-s">
        <h2>{t('Важно')}</h2>
        <p>{t('Ja!sno объясняет письма простыми словами и не заменяет юридическую консультацию.')}</p>
        <Link to="/datenschutz" className="link">
          Datenschutz
        </Link>
      </section>
    </>
  );
}
