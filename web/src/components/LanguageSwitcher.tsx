import { useEffect, useId, useState } from 'react';
import { LANG_NAMES, LANG_SHORT, LANGS, SOON_LANGS, getLang, isLang, setLang, t, useLang, type Lang } from '../i18n';
import { useSession } from '../store';
import { useCabinetQuery, useSetLanguageMutation } from '../store/api';

/**
 * L07: выбор языка сайта. Гость: язык запоминается в браузере.
 * После входа язык сохраняется и в кабинете (PATCH /cabinet {language}), чтобы письма и ИИ были на нём же.
 * Турецкий, арабский, испанский и чешский видны как «скоро», выбрать их нельзя.
 */
export function LanguageSwitcher({ variant = 'compact', id }: { variant?: 'compact' | 'field'; id?: string }) {
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

  const select = (
    <select
      id={selectId}
      className={variant === 'field' ? 'select' : 'select lang-select'}
      value={lang}
      disabled={saving.isLoading}
      aria-label={variant === 'compact' ? t('Язык сайта') : undefined}
      onChange={(e) => void change(e.target.value)}
      data-testid="lang-switcher"
    >
      {LANGS.map((l) => (
        <option key={l} value={l}>
          {variant === 'compact' ? LANG_SHORT[l] : LANG_NAMES[l]}
        </option>
      ))}
      <optgroup label={t('Скоро')}>
        {SOON_LANGS.map((s) => (
          <option key={s.code} value={s.code} disabled>
            {variant === 'compact' ? `${s.code.toUpperCase()} · ${t('скоро')}` : `${s.name} · ${t('скоро')}`}
          </option>
        ))}
      </optgroup>
    </select>
  );

  if (variant === 'compact') return select;
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
