import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { PageHeader } from '../../components/ui';
import { AI_CONSENT_LABEL, AI_CONSENT_LABEL_DE } from '../../lib/consent';
import { operator } from '../../lib/legal';
import { LEGAL_TEXTS, fillLegal, type LegalPage } from '../../lib/legalTexts';
import { LANG_NAMES, t, useLang, type Lang } from '../../i18n';

/**
 * UX 26.11 (#168): Impressum, Datenschutz и AGB по черновику workflow/261126/rechtstexte-entwurf.md.
 * Немецкий текст основной (lang="de"). На русском и украинском сайте сначала перевод с пометкой
 * «Maßgeblich ist die deutsche Fassung» и кнопкой немецкой версии.
 * Баннер «Entwurf, juristisch nicht geprüft» остаётся, пока текст не проверил юрист.
 */
function LegalView({ page }: { page: LegalPage }) {
  const siteLang = useLang();
  const [lang, setLang] = useState<Lang>(siteLang);
  const { hash } = useLocation();
  const vars = { ...operator(lang), consent: lang === 'de' ? AI_CONSENT_LABEL_DE : AI_CONSENT_LABEL };
  const sections = LEGAL_TEXTS[page][lang];

  // ссылки вида /datenschutz#ki ведут сразу к разделу
  useEffect(() => {
    const id = hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [hash, lang]);

  return (
    <>
      <div className="alert alert--warn stack-s" role="note" data-testid="legal-draft">
        <strong lang="de">Entwurf, juristisch nicht geprüft.</strong>
        {siteLang !== 'de' && <span>{t('Черновик для тестовой версии: юристом не проверен. Данные в квадратных скобках ещё не заполнены.')}</span>}
      </div>

      {siteLang !== 'de' && (
        <div className="card stack-s" style={{ padding: 12 }}>
          {lang !== 'de' && (
            <p className="small" style={{ margin: 0 }}>
              <strong lang="de">Maßgeblich ist die deutsche Fassung.</strong>{' '}
              {t('Это перевод для удобства, действует немецкий текст.')}
            </p>
          )}
          <div className="row wrap" style={{ gap: 8 }} role="group" aria-label={t('Язык текста')}>
            <button type="button" className="chip" aria-pressed={lang === 'de'} onClick={() => setLang('de')} lang="de">
              Deutsch (maßgeblich)
            </button>
            <button type="button" className="chip" aria-pressed={lang === siteLang} onClick={() => setLang(siteLang)}>
              {LANG_NAMES[siteLang]} · {t('перевод')}
            </button>
          </div>
        </div>
      )}

      <div className="stack" lang={lang} data-testid={`legal-${page}`}>
        {sections.map((s) => (
          <section key={s.title} id={s.id} className="card stack-s" style={{ scrollMarginTop: 16 }}>
            <h2 style={{ fontSize: 19 }}>{s.title}</h2>
            {s.blocks.map((b, i) =>
              typeof b === 'string' ? (
                <p key={i} style={{ margin: 0 }}>
                  {fillLegal(b, vars)}
                </p>
              ) : (
                <ul key={i} className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
                  {b.list.map((x) => (
                    <li key={x}>{fillLegal(x, vars)}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
      </div>
    </>
  );
}

/** K11 (#134), UX 26.11: Datenschutzerklärung. */
export function PrivacyPage() {
  return (
    <>
      <PageHeader title="Datenschutz" subtitle={t('Какие данные обрабатывает Ja!sno и зачем. Тестовая версия.')} />
      <LegalView page="datenschutz" />
      <Link to="/app/profile" className="link">
        {t('Профиль: согласие на анализ ИИ и удаление аккаунта')}
      </Link>
    </>
  );
}

/** Поправка 2 (23.11), UX 26.11: Impressum. */
export function ImpressumPage() {
  return (
    <>
      <PageHeader title="Impressum" subtitle={t('Кто отвечает за Ja!sno. Тестовая версия.')} />
      <LegalView page="impressum" />
    </>
  );
}

/** UX 26.11 (#168): AGB / Nutzungsbedingungen. */
export function AgbPage() {
  return (
    <>
      <PageHeader title="AGB" subtitle={t('Условия использования Ja!sno. Тестовая версия.')} />
      <LegalView page="agb" />
      <p className="small text-2">
        <Link to="/datenschutz" className="link">
          Datenschutz
        </Link>
        {' · '}
        <Link to="/beratung" className="link">
          {t('Найти консультацию')}
        </Link>
      </p>
    </>
  );
}
