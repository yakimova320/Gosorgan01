import type { Lang } from '../i18n';

/*
 * UX 26.11 (#168): Impressum, Datenschutzerklärung, AGB.
 * Источник: workflow/261126/rechtstexte-entwurf.md (структура по образцу amtly.app, своими словами).
 * ЮРИДИЧЕСКИ НЕ ПРОВЕРЕНО. Немецкий текст основной, RU и UA — перевод для удобства.
 * Длинные юридические тексты лежат здесь целиком на трёх языках, а не ключами t(): так их проще сверять
 * с черновиком и отдать юристу. Подстановки {name} {street} {city} {email} {phone} — из OPERATOR (lib/legal.ts),
 * {consent} — текст согласия на анализ ИИ (lib/consent.ts). Данные в [скобках] вписывает команда.
 */

export type LegalBlock = string | { list: string[] };
export interface LegalSection {
  /** якорь: /datenschutz#ki, /datenschutz#cookies */
  id?: string;
  title: string;
  blocks: LegalBlock[];
}
export type LegalPage = 'impressum' | 'datenschutz' | 'agb';

const IMPRESSUM: Record<Lang, LegalSection[]> = {
  de: [
    { title: 'Angaben gemäß § 5 DDG', blocks: ['{name}', '{street}', '{city}', 'Deutschland'] },
    { title: 'Kontakt', blocks: ['E-Mail: {email}', 'Telefon: {phone}'] },
    { title: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV', blocks: ['{name}, Anschrift wie oben'] },
    {
      title: 'Projekt',
      blocks: [
        'Ja!sno ist ein nicht kommerzielles Praktikumsprojekt im Rahmen der Weiterbildung „AI Engineer“ am Institut AIT. Testversion: nur Beispiel-Briefe.',
        '[Falls später ein Unternehmen betreibt: Registergericht, Registernummer, Vertretungsberechtigte, USt-IdNr.]',
      ],
    },
    {
      title: 'Verbraucherstreitbeilegung',
      blocks: ['Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.'],
    },
    {
      title: 'Haftung für Inhalte',
      blocks: [
        'Wir erstellen die Inhalte sorgfältig. Für Richtigkeit, Vollständigkeit und Aktualität, insbesondere der automatisch erzeugten Erklärungen, übernehmen wir keine Gewähr. Ja!sno ersetzt keine Rechtsberatung.',
      ],
    },
    {
      title: 'Haftung für Links',
      blocks: ['Für Inhalte verlinkter fremder Seiten sind deren Betreiber verantwortlich. Bei Hinweisen auf Rechtsverstöße entfernen wir Links umgehend.'],
    },
    {
      title: 'Urheberrecht',
      blocks: ['Texte, Illustrationen und Gestaltung von Ja!sno sind urheberrechtlich geschützt. Amtliche Formulare und Gesetzestexte gehören den jeweiligen Stellen.'],
    },
  ],
  ru: [
    { title: 'Сведения по § 5 DDG', blocks: ['{name}', '{street}', '{city}', 'Германия'] },
    { title: 'Контакт', blocks: ['E-Mail: {email}', 'Телефон: {phone}'] },
    { title: 'Ответственный за содержание по § 18 Abs. 2 MStV', blocks: ['{name}, адрес как выше'] },
    {
      title: 'Проект',
      blocks: [
        'Ja!sno — некоммерческий учебный проект в рамках курса «AI Engineer» в институте AIT. Тестовая версия: только примеры писем.',
        '[Если позже проект будет вести компания: регистрационный суд, регистрационный номер, представители, USt-IdNr.]',
      ],
    },
    {
      title: 'Урегулирование споров с потребителями',
      blocks: ['Мы не готовы и не обязаны участвовать в процедурах урегулирования споров в потребительской арбитражной службе.'],
    },
    {
      title: 'Ответственность за содержание',
      blocks: [
        'Мы готовим материалы тщательно, но не гарантируем их точность, полноту и актуальность, особенно автоматически созданных объяснений. Ja!sno не заменяет юридическую консультацию.',
      ],
    },
    {
      title: 'Ответственность за ссылки',
      blocks: ['За содержание чужих сайтов по ссылкам отвечают их владельцы. Если нам сообщат о нарушении закона, мы сразу уберём ссылку.'],
    },
    {
      title: 'Авторское право',
      blocks: ['Тексты, иллюстрации и оформление Ja!sno защищены авторским правом. Официальные формуляры и тексты законов принадлежат соответствующим ведомствам.'],
    },
  ],
  uk: [
    { title: 'Відомості за § 5 DDG', blocks: ['{name}', '{street}', '{city}', 'Німеччина'] },
    { title: 'Контакт', blocks: ['E-Mail: {email}', 'Телефон: {phone}'] },
    { title: 'Відповідальний за зміст за § 18 Abs. 2 MStV', blocks: ['{name}, адреса як вище'] },
    {
      title: 'Проєкт',
      blocks: [
        'Ja!sno — некомерційний навчальний проєкт у межах курсу «AI Engineer» в інституті AIT. Тестова версія: лише приклади листів.',
        '[Якщо пізніше проєкт вестиме компанія: реєстраційний суд, реєстраційний номер, представники, USt-IdNr.]',
      ],
    },
    {
      title: 'Врегулювання спорів зі споживачами',
      blocks: ['Ми не готові й не зобовʼязані брати участь у процедурах врегулювання спорів у споживчій арбітражній службі.'],
    },
    {
      title: 'Відповідальність за зміст',
      blocks: [
        'Ми готуємо матеріали ретельно, але не гарантуємо їхню точність, повноту й актуальність, особливо автоматично створених пояснень. Ja!sno не замінює юридичну консультацію.',
      ],
    },
    {
      title: 'Відповідальність за посилання',
      blocks: ['За зміст чужих сайтів за посиланнями відповідають їхні власники. Якщо нам повідомлять про порушення закону, ми одразу приберемо посилання.'],
    },
    {
      title: 'Авторське право',
      blocks: ['Тексти, ілюстрації та оформлення Ja!sno захищені авторським правом. Офіційні формуляри й тексти законів належать відповідним відомствам.'],
    },
  ],
};

const DATENSCHUTZ: Record<Lang, LegalSection[]> = {
  de: [
    {
      title: '1. Auf einen Blick',
      blocks: [
        'Ja!sno hilft, Briefe von Ämtern zu verstehen und Antworten zu entwerfen. Dafür verarbeiten wir die Daten Ihres Kontos und die Briefe, die Sie hochladen. Wir nutzen keine Werbung, kein Tracking und keine Analyse-Cookies. Sie können Ihre Daten jederzeit löschen.',
      ],
    },
    { title: '2. Verantwortliche Stelle', blocks: ['{name}, {street}, {city}, E-Mail: {email}'] },
    {
      title: '3. Hosting',
      blocks: [
        'Die Website und die Datenbank laufen bei [Hoster, Sitz, Serverstandort — Ziel: EU]. Der Hoster verarbeitet die Daten in unserem Auftrag (Art. 28 DSGVO). Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO.',
      ],
    },
    {
      title: '4. Welche Daten wir verarbeiten',
      blocks: [
        {
          list: [
            'Konto: E-Mail, Passwort (nur als Hash), Vorname, Nachname, Anschrift, Angaben im Profil, Sprache.',
            'Briefe: Fotos und Dateien, erkannter Text, Angaben mit Zitaten, Vorgänge, Fristen, Antwortentwürfe.',
            'Chat: Ihre Fragen und die Antworten. Im Chat ohne Konto speichern wir keine Fragen; die Frage geht nur für die Antwort an das KI-Modell (siehe 5). Bitte geben Sie dort keine Namen, Anschriften oder Nummern ein.',
            'Server-Protokolle: IP-Adresse, Zeitpunkt, Browser — zur Fehler- und Angriffserkennung, Löschung nach [14] Tagen.',
          ],
        },
        'Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Nutzung des Dienstes), lit. f (Sicherheit).',
      ],
    },
    {
      id: 'ki',
      title: '5. Auswertung von Briefen mit KI (Einwilligung)',
      blocks: [
        'Briefe werden nur ausgewertet, wenn Sie dafür gesondert eingewilligt haben (Art. 6 Abs. 1 lit. a DSGVO; bei Gesundheitsdaten im Brief Art. 9 Abs. 2 lit. a DSGVO).',
        'Wortlaut der Einwilligung: „{consent}“',
        {
          list: [
            'Empfänger: Google (Gemini API). Die Verarbeitung kann außerhalb der EU, auch in den USA, stattfinden. Grundlage der Übermittlung: [EU-US Data Privacy Framework / Standardvertragsklauseln — prüfen] bzw. Ihre Einwilligung (Art. 49 Abs. 1 lit. a DSGVO).',
            'Vor dem Senden ersetzen wir E-Mail, IBAN, BIC, Steuer- und Versicherungsnummern und Telefonnummern im Text durch Platzhalter. Auf Fotos bleiben sie sichtbar.',
            'Zweck: Brief lesen, erklären, Antwortentwurf prüfen. Nicht für Werbung, nicht zum Training eigener Modelle.',
            'Widerruf: jederzeit im Profil. Ohne Einwilligung funktioniert das Konto, neue Briefe können aber nicht ausgewertet werden.',
          ],
        },
      ],
    },
    {
      id: 'cookies',
      title: '6. Speicher im Browser',
      blocks: [
        'Wir speichern im Browser nur, was für den Betrieb nötig ist (Anmeldung, Sprache, Hinweise). Das ist technisch erforderlich (§ 25 Abs. 2 TDDDG). Keine Werbe- oder Analyse-Cookies, daher kein Cookie-Banner.',
      ],
    },
    {
      title: '7. Speicherdauer und Löschung',
      blocks: [
        {
          list: [
            'Einzelne Briefe löschen Sie jederzeit mit allen Dateien und Angaben.',
            '„Konto löschen“ im Profil entfernt alle Daten: Konto, Briefe, Dateien, Vorgänge und KI-Protokoll.',
            'Konten ohne Anmeldung seit 360 Tagen löschen wir automatisch.',
          ],
        },
      ],
    },
    {
      title: '8. Ihre Rechte',
      blocks: [
        'Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch (Art. 15–21 DSGVO) und Widerruf von Einwilligungen (Art. 7 Abs. 3 DSGVO). Beschwerde bei einer Aufsichtsbehörde, z. B. [zuständige Landesdatenschutzbehörde].',
      ],
    },
    { title: '9. Verschlüsselung', blocks: ['Die Verbindung ist mit TLS verschlüsselt (https, Schloss-Symbol im Browser).'] },
  ],
  ru: [
    {
      title: '1. Коротко',
      blocks: [
        'Ja!sno помогает понять письма ведомств и составить ответ. Для этого мы обрабатываем данные вашего аккаунта и письма, которые вы загружаете. У нас нет рекламы, трекинга и аналитических cookies. Вы можете удалить свои данные в любой момент.',
      ],
    },
    { title: '2. Кто отвечает (Verantwortlicher)', blocks: ['{name}, {street}, {city}, E-Mail: {email}'] },
    {
      title: '3. Хостинг',
      blocks: [
        'Сайт и база данных работают у [хостер, местонахождение, где стоят серверы — цель: ЕС]. Хостер обрабатывает данные по нашему поручению (Art. 28 DSGVO). Основание: Art. 6 Abs. 1 lit. b и f DSGVO.',
      ],
    },
    {
      title: '4. Какие данные мы обрабатываем',
      blocks: [
        {
          list: [
            'Аккаунт: e-mail, пароль (только в виде хэша), имя, фамилия, адрес, данные профиля, язык.',
            'Письма: фото и файлы, распознанный текст, факты с цитатами, дела, сроки, черновики ответов.',
            'Чат: ваши вопросы и ответы. В чате без аккаунта мы не сохраняем вопросы; вопрос уходит модели ИИ только ради ответа (см. 5). Не пишите там имена, адреса и номера.',
            'Журналы сервера: IP-адрес, время, браузер — чтобы находить ошибки и атаки, удаляются через [14] дней.',
          ],
        },
        'Основание: Art. 6 Abs. 1 lit. b DSGVO (работа сервиса), lit. f (безопасность).',
      ],
    },
    {
      id: 'ki',
      title: '5. Анализ писем ИИ (отдельное согласие)',
      blocks: [
        'Письма анализируются, только если вы дали на это отдельное согласие (Art. 6 Abs. 1 lit. a DSGVO; если в письме есть данные о здоровье — Art. 9 Abs. 2 lit. a DSGVO).',
        'Текст согласия: «{consent}»',
        {
          list: [
            'Получатель: Google (Gemini API). Обработка может идти за пределами ЕС, в том числе в США. Основание передачи: [EU-US Data Privacy Framework / стандартные договорные условия — проверить] или ваше согласие (Art. 49 Abs. 1 lit. a DSGVO).',
            'Перед отправкой мы заменяем в тексте e-mail, IBAN, BIC, налоговые и страховые номера и телефоны метками. На фото они остаются видны.',
            'Зачем: прочитать письмо, объяснить его, проверить черновик ответа. Не для рекламы и не для обучения собственных моделей.',
            'Отзыв: в любой момент в профиле. Без согласия аккаунт работает, но новые письма разобрать нельзя.',
          ],
        },
      ],
    },
    {
      id: 'cookies',
      title: '6. Хранение в браузере',
      blocks: [
        'В браузере мы храним только то, что нужно для работы (вход, язык, подсказки). Это технически необходимо (§ 25 Abs. 2 TDDDG). Рекламных и аналитических cookies нет, поэтому нет и cookie-баннера.',
      ],
    },
    {
      title: '7. Сколько хранится и как удалить',
      blocks: [
        {
          list: [
            'Отдельное письмо вы удаляете в любой момент вместе со всеми файлами и фактами.',
            '«Удалить аккаунт» в профиле удаляет всё: аккаунт, письма, файлы, дела и журнал обращений к ИИ.',
            'Аккаунты без входа дольше 360 дней мы удаляем автоматически.',
          ],
        },
      ],
    },
    {
      title: '8. Ваши права',
      blocks: [
        'Получить сведения, исправить, удалить, ограничить обработку, перенести данные, возразить (Art. 15–21 DSGVO) и отозвать согласие (Art. 7 Abs. 3 DSGVO). Пожаловаться в надзорный орган, например [земельное ведомство по защите данных].',
      ],
    },
    { title: '9. Шифрование', blocks: ['Соединение защищено TLS (https, значок замка в браузере).'] },
  ],
  uk: [
    {
      title: '1. Коротко',
      blocks: [
        'Ja!sno допомагає зрозуміти листи відомств і скласти відповідь. Для цього ми обробляємо дані вашого акаунта й листи, які ви завантажуєте. У нас немає реклами, трекінгу й аналітичних cookies. Ви можете видалити свої дані будь-коли.',
      ],
    },
    { title: '2. Хто відповідає (Verantwortlicher)', blocks: ['{name}, {street}, {city}, E-Mail: {email}'] },
    {
      title: '3. Хостинг',
      blocks: [
        'Сайт і база даних працюють у [хостер, місцезнаходження, де стоять сервери — мета: ЄС]. Хостер обробляє дані за нашим дорученням (Art. 28 DSGVO). Підстава: Art. 6 Abs. 1 lit. b і f DSGVO.',
      ],
    },
    {
      title: '4. Які дані ми обробляємо',
      blocks: [
        {
          list: [
            'Акаунт: e-mail, пароль (лише у вигляді хешу), імʼя, прізвище, адреса, дані профілю, мова.',
            'Листи: фото й файли, розпізнаний текст, факти з цитатами, справи, строки, чернетки відповідей.',
            'Чат: ваші запитання й відповіді. У чаті без акаунта ми не зберігаємо запитання; запитання йде до моделі ШІ лише заради відповіді (див. 5). Не пишіть там імена, адреси й номери.',
            'Журнали сервера: IP-адреса, час, браузер — щоб знаходити помилки й атаки, видаляються через [14] днів.',
          ],
        },
        'Підстава: Art. 6 Abs. 1 lit. b DSGVO (робота сервісу), lit. f (безпека).',
      ],
    },
    {
      id: 'ki',
      title: '5. Аналіз листів ШІ (окрема згода)',
      blocks: [
        'Листи аналізуються, лише якщо ви дали на це окрему згоду (Art. 6 Abs. 1 lit. a DSGVO; якщо в листі є дані про здоровʼя — Art. 9 Abs. 2 lit. a DSGVO).',
        'Текст згоди: «{consent}»',
        {
          list: [
            'Отримувач: Google (Gemini API). Обробка може відбуватися за межами ЄС, зокрема в США. Підстава передачі: [EU-US Data Privacy Framework / стандартні договірні умови — перевірити] або ваша згода (Art. 49 Abs. 1 lit. a DSGVO).',
            'Перед надсиланням ми замінюємо в тексті e-mail, IBAN, BIC, податкові й страхові номери та телефони мітками. На фото вони залишаються видимими.',
            'Навіщо: прочитати лист, пояснити його, перевірити чернетку відповіді. Не для реклами й не для навчання власних моделей.',
            'Відкликання: будь-коли в профілі. Без згоди акаунт працює, але нові листи розібрати не можна.',
          ],
        },
      ],
    },
    {
      id: 'cookies',
      title: '6. Зберігання в браузері',
      blocks: [
        'У браузері ми зберігаємо лише те, що потрібно для роботи (вхід, мова, підказки). Це технічно необхідно (§ 25 Abs. 2 TDDDG). Рекламних і аналітичних cookies немає, тому немає й cookie-банера.',
      ],
    },
    {
      title: '7. Скільки зберігається і як видалити',
      blocks: [
        {
          list: [
            'Окремий лист ви видаляєте будь-коли разом з усіма файлами й фактами.',
            '«Видалити акаунт» у профілі видаляє все: акаунт, листи, файли, справи й журнал звернень до ШІ.',
            'Акаунти без входу довше 360 днів ми видаляємо автоматично.',
          ],
        },
      ],
    },
    {
      title: '8. Ваші права',
      blocks: [
        'Отримати відомості, виправити, видалити, обмежити обробку, перенести дані, заперечити (Art. 15–21 DSGVO) і відкликати згоду (Art. 7 Abs. 3 DSGVO). Поскаржитися до наглядового органу, наприклад [земельне відомство із захисту даних].',
      ],
    },
    { title: '9. Шифрування', blocks: ['Зʼєднання захищене TLS (https, значок замка в браузері).'] },
  ],
};

const AGB: Record<Lang, LegalSection[]> = {
  de: [
    { title: '1. Geltungsbereich', blocks: ['Diese Bedingungen gelten für die Nutzung von Ja!sno (Website und Konto). Anbieter: {name}, {street}, {city}.'] },
    {
      title: '2. Was Ja!sno macht',
      blocks: ['Ja!sno erklärt Briefe von Ämtern in einfacher Sprache, zeigt Fristen, beantwortet allgemeine Fragen und erstellt Entwürfe für Antworten. Ja!sno schickt nichts selbst an ein Amt.'],
    },
    {
      title: '3. Keine Rechtsberatung',
      blocks: [
        'Ja!sno leistet keine Rechtsdienstleistung im Sinne des Rechtsdienstleistungsgesetzes (RDG) und prüft keinen Einzelfall rechtlich. Für Widerspruch, Klage oder schwierige Fälle wenden Sie sich an eine Beratungsstelle oder eine Anwältin/einen Anwalt. Hinweise zu Beratung: Seite „Beratung finden“.',
      ],
    },
    {
      title: '4. Ihre Pflichten',
      blocks: [
        {
          list: [
            'Prüfen Sie jede Erklärung und jeden Entwurf, bevor Sie handeln oder etwas abschicken. Für den abgeschickten Text sind Sie verantwortlich.',
            'Nutzen Sie Ja!sno nur rechtmäßig und mit wahren Angaben, keine automatisierten Zugriffe.',
            'In der Testversion laden Sie nur Beispiel-Briefe hoch, keine echten Dokumente.',
          ],
        },
      ],
    },
    {
      title: '5. Konto',
      blocks: ['Für das Konto braucht es eine E-Mail-Adresse und ein Passwort. Halten Sie Ihre Zugangsdaten geheim. Sie können das Konto jederzeit im Profil löschen.'],
    },
    {
      title: '6. Gewährleistung und Verfügbarkeit',
      blocks: [
        'Automatisch erzeugte Erklärungen können Fehler enthalten. Wir übernehmen keine Gewähr für Richtigkeit, Vollständigkeit und Aktualität. Ja!sno ist eine Testversion; wir können den Dienst ändern, unterbrechen oder einstellen.',
      ],
    },
    {
      title: '7. Haftung',
      blocks: [
        'Wir haften unbeschränkt bei Vorsatz, grober Fahrlässigkeit, Verletzung von Leben, Körper oder Gesundheit und nach dem Produkthaftungsgesetz. Bei leichter Fahrlässigkeit haften wir nur für die Verletzung wesentlicher Pflichten und begrenzt auf den typischen, vorhersehbaren Schaden. Im Übrigen ist die Haftung ausgeschlossen.',
      ],
    },
    { title: '8. Kosten', blocks: ['Ja!sno ist kostenlos. Sollte sich das ändern, informieren wir vorher; ohne Ihre Zustimmung entstehen keine Kosten.'] },
    { title: '9. Datenschutz', blocks: ['Siehe Datenschutzerklärung.'] },
    {
      title: '10. Änderungen',
      blocks: ['Wir können diese Bedingungen anpassen und informieren angemeldete Nutzerinnen und Nutzer vorher per E-Mail oder beim Anmelden.'],
    },
    { title: '11. Schlussbestimmungen', blocks: ['Es gilt deutsches Recht. Sollte eine Bestimmung unwirksam sein, bleiben die übrigen wirksam.', 'Stand: [Datum]'] },
  ],
  ru: [
    { title: '1. Область действия', blocks: ['Эти условия действуют при использовании Ja!sno (сайт и аккаунт). Поставщик: {name}, {street}, {city}.'] },
    {
      title: '2. Что делает Ja!sno',
      blocks: ['Ja!sno простыми словами объясняет письма ведомств, показывает сроки, отвечает на общие вопросы и готовит черновики ответов. Сам Ja!sno ничего в ведомство не отправляет.'],
    },
    {
      title: '3. Это не юридическая консультация',
      blocks: [
        'Ja!sno не оказывает правовых услуг в смысле закона о правовых услугах (RDG) и не проверяет отдельный случай юридически. Для возражения (Widerspruch), иска или сложных случаев обратитесь в консультацию или к адвокату. Где получить консультацию: страница «Найти консультацию».',
      ],
    },
    {
      title: '4. Ваши обязанности',
      blocks: [
        {
          list: [
            'Проверяйте каждое объяснение и каждый черновик, прежде чем действовать или что-то отправлять. За отправленный текст отвечаете вы.',
            'Используйте Ja!sno только законно и с правдивыми данными, без автоматических запросов.',
            'В тестовой версии загружайте только примеры писем, не настоящие документы.',
          ],
        },
      ],
    },
    {
      title: '5. Аккаунт',
      blocks: ['Для аккаунта нужны e-mail и пароль. Держите данные для входа в тайне. Удалить аккаунт можно в любой момент в профиле.'],
    },
    {
      title: '6. Гарантия и доступность',
      blocks: [
        'Автоматически созданные объяснения могут содержать ошибки. Мы не гарантируем их точность, полноту и актуальность. Ja!sno — тестовая версия; мы можем изменить, прервать или прекратить работу сервиса.',
      ],
    },
    {
      title: '7. Ответственность',
      blocks: [
        'Мы несём неограниченную ответственность при умысле, грубой небрежности, вреде жизни, телу или здоровью и по закону об ответственности за продукцию (Produkthaftungsgesetz). При лёгкой небрежности — только за нарушение существенных обязанностей и в пределах типичного предвидимого ущерба. В остальном ответственность исключена.',
      ],
    },
    { title: '8. Стоимость', blocks: ['Ja!sno бесплатный. Если это изменится, мы сообщим заранее; без вашего согласия расходов не будет.'] },
    { title: '9. Защита данных', blocks: ['См. Datenschutz.'] },
    {
      title: '10. Изменения',
      blocks: ['Мы можем изменить эти условия и заранее сообщим об этом зарегистрированным пользователям по e-mail или при входе.'],
    },
    { title: '11. Заключительные положения', blocks: ['Действует право Германии. Если какое-то положение недействительно, остальные остаются в силе.', 'Редакция: [Datum]'] },
  ],
  uk: [
    { title: '1. Сфера дії', blocks: ['Ці умови діють під час користування Ja!sno (сайт і акаунт). Постачальник: {name}, {street}, {city}.'] },
    {
      title: '2. Що робить Ja!sno',
      blocks: ['Ja!sno простими словами пояснює листи відомств, показує строки, відповідає на загальні запитання й готує чернетки відповідей. Сам Ja!sno нічого до відомства не надсилає.'],
    },
    {
      title: '3. Це не юридична консультація',
      blocks: [
        'Ja!sno не надає правових послуг у розумінні закону про правові послуги (RDG) і не перевіряє окремий випадок юридично. Для заперечення (Widerspruch), позову чи складних випадків зверніться до консультації або до адвоката. Де отримати консультацію: сторінка «Знайти консультацію».',
      ],
    },
    {
      title: '4. Ваші обовʼязки',
      blocks: [
        {
          list: [
            'Перевіряйте кожне пояснення й кожну чернетку, перш ніж діяти чи щось надсилати. За надісланий текст відповідаєте ви.',
            'Користуйтеся Ja!sno лише законно й з правдивими даними, без автоматичних запитів.',
            'У тестовій версії завантажуйте лише приклади листів, не справжні документи.',
          ],
        },
      ],
    },
    {
      title: '5. Акаунт',
      blocks: ['Для акаунта потрібні e-mail і пароль. Тримайте дані для входу в таємниці. Видалити акаунт можна будь-коли в профілі.'],
    },
    {
      title: '6. Гарантія й доступність',
      blocks: [
        'Автоматично створені пояснення можуть містити помилки. Ми не гарантуємо їхню точність, повноту й актуальність. Ja!sno — тестова версія; ми можемо змінити, перервати чи припинити роботу сервісу.',
      ],
    },
    {
      title: '7. Відповідальність',
      blocks: [
        'Ми несемо необмежену відповідальність у разі умислу, грубої недбалості, шкоди життю, тілу чи здоровʼю та за законом про відповідальність за продукцію (Produkthaftungsgesetz). У разі легкої недбалості — лише за порушення суттєвих обовʼязків і в межах типової передбачуваної шкоди. В іншому відповідальність виключена.',
      ],
    },
    { title: '8. Вартість', blocks: ['Ja!sno безкоштовний. Якщо це зміниться, ми повідомимо заздалегідь; без вашої згоди витрат не буде.'] },
    { title: '9. Захист даних', blocks: ['Див. Datenschutz.'] },
    {
      title: '10. Зміни',
      blocks: ['Ми можемо змінити ці умови й заздалегідь повідомимо про це зареєстрованих користувачів e-mail або під час входу.'],
    },
    { title: '11. Прикінцеві положення', blocks: ['Діє право Німеччини. Якщо якесь положення недійсне, решта залишаються чинними.', 'Редакція: [Datum]'] },
  ],
};

export const LEGAL_TEXTS: Record<LegalPage, Record<Lang, LegalSection[]>> = {
  impressum: IMPRESSUM,
  datenschutz: DATENSCHUTZ,
  agb: AGB,
};

/** Подставляет {name} и т. п.; неизвестное имя остаётся как есть. */
export function fillLegal(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}
