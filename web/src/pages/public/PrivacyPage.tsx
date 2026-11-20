import { Link } from 'react-router';
import { PageHeader } from '../../components/ui';
import { AI_CONSENT_DETAILS, AI_CONSENT_LABEL, AI_CONSENT_LABEL_DE } from '../../lib/consent';

/**
 * K11 (#134): страница Datenschutz. Черновик команды для тестовой версии: юридически не проверен,
 * перед публикацией текст проверяет человек и дополняет данные ответственного (Verantwortlicher).
 */
export function PrivacyPage() {
  return (
    <>
      <PageHeader title="Datenschutz" subtitle="Какие данные обрабатывает Ja!sno и зачем. Тестовая версия." />
      <div className="alert alert--warn" role="note">
        Черновик для тестовой версии. Текст ещё не проверен юристом. Загружайте только примеры писем.
      </div>

      <section className="card stack-s">
        <h2>Кто отвечает (Verantwortlicher)</h2>
        <p>Команда проекта Ja!sno. Контакт для вопросов о данных появится вместе с Impressum.</p>
      </section>

      <section className="card stack-s">
        <h2>Какие данные</h2>
        <ul className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Аккаунт: e-mail, пароль (хранится только в виде хэша), имя, фамилия, адрес, номера из профиля.</li>
          <li>Письма: файлы и фото, распознанный текст, факты, дела, сроки, черновики ответов.</li>
          <li>Журнал обращений к модели ИИ: что отправлено и что получено, личные номера заменены метками.</li>
        </ul>
      </section>

      <section className="card stack-s" id="ki">
        <h2>Анализ писем ИИ (отдельное согласие)</h2>
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
          Основание: согласие (Art. 6 Abs. 1 lit. a DSGVO). Без согласия аккаунт работает, но новое письмо загрузить и
          разобрать нельзя.
        </p>
      </section>

      <section className="card stack-s" id="cookies">
        <h2>Cookies и хранение в браузере</h2>
        <p>
          Ja!sno не использует рекламу, аналитику и трекинг. В браузере хранится только то, что нужно для работы: токен
          входа и отметка, что вы прочитали подсказку о хранении. Это технически необходимо (§ 25 Abs. 2 TDDDG), согласие
          для этого не требуется.
        </p>
      </section>

      <section className="card stack-s">
        <h2>Сколько хранится и как удалить</h2>
        <ul className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Письмо можно удалить в любой момент: вместе с файлами и фактами.</li>
          <li>
            «Удалить аккаунт» в профиле удаляет всё: аккаунт, письма, файлы, дела и журнал обращений к модели.
          </li>
          <li>Аккаунт без входа дольше 90 дней удаляется автоматически.</li>
        </ul>
      </section>

      <section className="card stack-s">
        <h2>Ваши права</h2>
        <p>
          Узнать, исправить или удалить свои данные, ограничить обработку, получить данные, отозвать согласие (Art. 15–21
          DSGVO), пожаловаться в надзорный орган по защите данных.
        </p>
        <Link to="/app/profile" className="link">
          Профиль: согласие на анализ ИИ и удаление аккаунта
        </Link>
      </section>
    </>
  );
}
