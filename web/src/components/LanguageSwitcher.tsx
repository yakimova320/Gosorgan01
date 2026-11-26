import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { LANG_NAMES, LANG_SHORT, LANGS, SOON_LANGS, getLang, isLang, setLang, t, useLang, type Lang } from '../i18n';
import { useSession } from '../store';
import { useCabinetQuery, useSetLanguageMutation } from '../store/api';
import { useDisclosure } from '../lib/disclosure';
import { Flag } from './Flag';

/**
 * L07: выбор языка сайта. Гость: язык запоминается в браузере.
 * После входа язык сохраняется и в кабинете (PATCH /cabinet {language}), чтобы письма и ИИ были на нём же.
 * Турецкий, арабский, испанский и чешский видны как «скоро», выбрать их нельзя.
 */
export function LanguageSwitcher({
  variant = 'compact',
  id,
  placement = 'down',
}: {
  variant?: 'compact' | 'field';
  id?: string;
  /** compact: список открывается вниз (шапка) или вверх (меню кабинета снизу) */
  placement?: 'down' | 'up';
}) {
  const lang = useLang();
  const { token } = useSession();
  const [saveLanguage, saving] = useSetLanguageMutation();
  const [error, setError] = useState(false);
  const autoId = useId();
  const selectId = id ?? `lang-${autoId}`;

  const change = async (value: string) => {
    if (!isLang(value) || value === lang) return;
    setError(false);
    if (token) {
      try {
        await saveLanguage(value).unwrap();
      } catch {
        setError(true);
        return;
      }
    }
    setLang(value);
  };

  if (variant === 'compact') return <LanguageMenu lang={lang} disabled={saving.isLoading} error={error} placement={placement} onChange={(v) => void change(v)} />;

  const select = (
    <select
      id={selectId}
      className="select"
      value={lang}
      disabled={saving.isLoading}
      onChange={(e) => void change(e.target.value)}
      data-testid="lang-field"
    >
      {LANGS.map((l) => (
        <option key={l} value={l}>
          {LANG_NAMES[l]}
        </option>
      ))}
      <optgroup label={t('Скоро')}>
        {SOON_LANGS.map((s) => (
          <option key={s.code} value={s.code} disabled>
            {`${s.name} · ${t('скоро')}`}
          </option>
        ))}
      </optgroup>
    </select>
  );

  return (
    <div className="field">
      <label htmlFor={selectId}>{t('Язык')}</label>
      {select}
      <span className="muted">
        {t('Ответы Ja!sno, объяснения писем и e-mail приходят на этом языке. Черновик ведомству всегда на немецком.')}
      </span>
      <span className="muted">
        {t('Скоро: {list}.', { list: SOON_LANGS.map((s) => s.name).join(', ') })}
      </span>
      {error && (
        <span className="field-error" role="alert">
          {t('Не получилось сохранить язык. Попробуйте ещё раз.')}
        </span>
      )}
    </div>
  );
}

type Option = { code: string; short: string; name: string; soon: boolean };
const OPTIONS: Option[] = [
  ...LANGS.map((l) => ({ code: l, short: LANG_SHORT[l], name: LANG_NAMES[l], soon: false })),
  ...SOON_LANGS.map((s) => ({ code: s.code, short: s.code.toUpperCase(), name: s.name, soon: true })),
];
const ENABLED = OPTIONS.filter((o) => !o.soon).map((o) => o.code);

/**
 * UX 26.11: свой выпадающий список вместо select, чтобы показать флаги.
 * ARIA-шаблон listbox: ↑ ↓ Home End выбирают, Enter или пробел применяет, Esc и Tab закрывают.
 */
function LanguageMenu({
  lang,
  disabled,
  error,
  placement,
  onChange,
}: {
  lang: Lang;
  disabled: boolean;
  error: boolean;
  placement: 'down' | 'up';
  onChange: (value: string) => void;
}) {
  const d = useDisclosure<HTMLButtonElement, HTMLUListElement>();
  const [active, setActive] = useState<string>(lang);
  const listRef = d.panelRef;
  const optionId = (code: string) => `${d.panelId}-${code}`;
  const current = OPTIONS.find((o) => o.code === lang)!;

  useEffect(() => {
    if (d.open) listRef.current?.focus();
  }, [d.open, listRef]);

  const openWith = (code: string) => {
    setActive(code);
    d.setOpen(true);
  };

  const pick = (code: string) => {
    d.close();
    onChange(code);
  };

  const move = (step: number) => {
    const i = ENABLED.indexOf(active);
    setActive(ENABLED[(i + step + ENABLED.length) % ENABLED.length]);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openWith(lang);
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home') setActive(ENABLED[0]);
    else if (e.key === 'End') setActive(ENABLED[ENABLED.length - 1]);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape') {
      // закрыть только список, не меню вокруг него
      e.stopPropagation();
      d.close();
    }
    else if (e.key === 'Tab') {
      d.close(false);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <div className={`lang-menu lang-menu--${placement}`}>
      <button
        ref={d.buttonRef}
        type="button"
        className="lang-menu__button"
        aria-haspopup="listbox"
        {...d.buttonProps}
        aria-label={`${t('Язык сайта')}: ${current.name}`}
        disabled={disabled}
        data-testid="lang-switcher"
        data-value={lang}
        onClick={() => (d.open ? d.close() : openWith(lang))}
        onKeyDown={onButtonKey}
      >
        <span>{current.short}</span>
        <Flag code={current.code} />
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" className="lang-menu__chevron">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {d.open && (
        <ul
          ref={listRef}
          id={d.panelId}
          role="listbox"
          tabIndex={-1}
          className="lang-menu__list"
          aria-label={t('Язык сайта')}
          aria-activedescendant={optionId(active)}
          onKeyDown={onListKey}
          data-testid="lang-list"
        >
          {OPTIONS.map((o) => (
            <li
              key={o.code}
              id={optionId(o.code)}
              role="option"
              aria-selected={o.code === lang}
              aria-disabled={o.soon || undefined}
              className={`lang-menu__option${o.code === active ? ' is-active' : ''}`}
              data-lang={o.code}
              onPointerMove={() => !o.soon && setActive(o.code)}
              onClick={() => !o.soon && pick(o.code)}
            >
              <span className="lang-menu__code">{o.short}</span>
              <span className="lang-menu__name">
                {o.name}
                {o.soon && <span className="muted"> · {t('скоро')}</span>}
              </span>
              <Flag code={o.code} />
            </li>
          ))}
        </ul>
      )}
      {error && (
        <span className="field-error lang-menu__error" role="alert">
          {t('Не получилось сохранить язык. Попробуйте ещё раз.')}
        </span>
      )}
    </div>
  );
}

/**
 * После входа язык кабинета главный: если он другой, сайт переключается на него.
 * Так на новом устройстве сразу нужный язык.
 */
export function useCabinetLanguageSync(): void {
  const { token } = useSession();
  const cabinet = useCabinetQuery(undefined, { skip: !token });
  const language = cabinet.data?.language;
  useEffect(() => {
    if (isLang(language) && language !== getLang()) setLang(language as Lang);
  }, [language]);
}
