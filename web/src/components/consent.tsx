import { useState } from 'react';
import { Link } from 'react-router';
import { errorText } from '../api/errors';
import { AI_CONSENT_DETAILS, AI_CONSENT_LABEL, AI_CONSENT_LABEL_DE } from '../lib/consent';
import { useSetAiConsentMutation } from '../store/api';

/**
 * K11 (#134): согласие на анализ письма ИИ перед загрузкой. Чекбокс не отмечен заранее,
 * кнопка активна только после отметки. После согласия кэш кабинета обновляется (тег Cabinet).
 */
export function AiConsentCard() {
  const [checked, setChecked] = useState(false);
  const [setConsent, state] = useSetAiConsentMutation();
  return (
    <div className="card stack" data-testid="ai-consent">
      <h2>Нужно ваше согласие</h2>
      <p className="small text-2">
        Чтобы разобрать письмо, Ja!sno передаёт его текст модели ИИ. Без согласия загрузить письмо нельзя.
      </p>
      <ul className="small stack-s" style={{ margin: 0, paddingLeft: 18 }}>
        {AI_CONSENT_DETAILS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="field">
        <label className="checkbox" htmlFor="ai-consent">
          <input id="ai-consent" type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            {AI_CONSENT_LABEL}{' '}
            <span lang="de" className="text-2">
              ({AI_CONSENT_LABEL_DE})
            </span>
          </span>
        </label>
      </div>
      {state.isError && (
        <div className="alert alert--error" role="alert">
          {errorText(state.error)}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary"
        disabled={!checked || state.isLoading}
        onClick={() => void setConsent(true)}
      >
        {state.isLoading ? 'Сохраняем…' : 'Дать согласие'}
      </button>
      <Link to="/datenschutz" className="link small">
        Подробно: Datenschutz
      </Link>
    </div>
  );
}

/** Профиль: состояние согласия, дать или отозвать. */
export function AiConsentSection({ given, at }: { given: boolean; at: string | null }) {
  const [setConsent, state] = useSetAiConsentMutation();
  return (
    <div className="card stack-s" role="group" aria-labelledby="ai-consent-title" data-testid="ai-consent-profile">
      <h3 id="ai-consent-title">Анализ писем ИИ</h3>
      <p className="small">
        {given
          ? `Согласие дано${at ? ` ${new Date(at).toLocaleDateString('ru-RU')}` : ''}. Письма можно загружать.`
          : 'Согласия нет: загрузить и разобрать новое письмо нельзя.'}
      </p>
      <p className="small text-2">{AI_CONSENT_LABEL}</p>
      {state.isError && (
        <div className="alert alert--error" role="alert">
          {errorText(state.error)}
        </div>
      )}
      <div className="row wrap">
        <button
          type="button"
          className={given ? 'btn btn--secondary btn--small' : 'btn btn--primary btn--small'}
          disabled={state.isLoading}
          onClick={() => void setConsent(!given)}
        >
          {given ? 'Отозвать согласие' : 'Дать согласие'}
        </button>
        <Link to="/datenschutz" className="link small">
          Datenschutz
        </Link>
      </div>
    </div>
  );
}
